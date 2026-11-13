// Replies from remote participants as recap contributions (spec 6 recap, 7 ActivityPub; decisions
// D44, D45; 0.9 step 12a): a `Note` from a participant who joined, addressed privately to one of
// our actors and `inReplyTo` the plan's `Event`, becomes a contribution under the web's rules (the
// recap open, 1,000 characters and/or one link, at most 20 per person); the author's own `Update`
// and `Delete` of that Note edit and delete it. A new or edited contribution reaches the other
// participants, never its author. Anything else is ignored silently. The Note's address is kept
// only as a keyed hash (`remote_contributions`).
import { CONTRIBUTION_LIMITS, isRecapOpen, validateContribution } from "../domain/recap.ts";
import type { Plan } from "../domain/plan.ts";
import type { PlanResponse } from "../domain/response.ts";
import { attributedActor } from "./attribution.ts";
import {
  publishContribution,
  syncContributionNotes,
  withdrawNotesOfContribution,
} from "./contribution-notes.ts";
import { INSTANCE_ACTOR } from "./following.ts";
import type { PlanDeps } from "./plans.ts";

export type RemoteReplyResult = "added" | "updated" | "deleted" | "ignored" | "limited";

interface Reply {
  /** The plan whose `Event` the reply answers. */
  planId?: string | undefined;
  /**
   * Or the identifier in the address of one of our Notes it answers (Mastodon and others answer
   * the Note, not the `Event`): it stands for the plan that Note was sent about, and only its
   * recipient may answer it.
   */
  ourNoteId?: string | undefined;
  /** The signer, whose own Note this must be. */
  actorId: string;
  /** The remote Note's address. */
  noteId: string;
  /**
   * The local actors the Note and its activity are addressed to, as identifiers; empty when it is
   * addressed to anyone else, or no one: not private.
   */
  addressedTo: readonly string[];
  /** Plain text, and the link split from it. */
  body: string;
  linkUrl: string;
  /**
   * Takes the sender's server's quota, false when it is used up. Called once, and only when the
   * reply is plausible: every other check has passed and it is about to change something. Content
   * that is simply not for us costs the server nothing.
   */
  admit?: () => boolean;
}

/** The plan a reply is about and, for a reply to one of our Notes, the one response it was sent to. */
async function resolveTarget(
  deps: PlanDeps,
  target: Pick<Reply, "planId" | "ourNoteId">,
): Promise<{ planId: string; recipient: string | undefined } | undefined> {
  if (target.ourNoteId === undefined) {
    return target.planId === undefined
      ? undefined
      : { planId: target.planId, recipient: undefined };
  }
  const actors = deps.posterActors;
  const note =
    (await actors?.contributionNotes.findByNoteId(target.ourNoteId)) ??
    (await actors?.notes.findByNoteId(target.ourNoteId));
  return note === undefined ? undefined : { planId: note.planId, recipient: note.responseId };
}

/**
 * The plan and the author's response, if the reply may count: federation on, the actor joined,
 * for a reply to one of our Notes the very person it was sent to, the recap open, and the Note
 * private to one of our actors (the instance's, the plan's, or one that sent this participant a
 * Note, so a reply to it still counts after the plan changed hands).
 */
async function accepted(
  deps: PlanDeps,
  request: Reply,
): Promise<{ plan: Plan; response: PlanResponse } | undefined> {
  const actors = deps.posterActors;
  if (actors?.enabled !== true) return undefined;
  const target = await resolveTarget(deps, request);
  if (target === undefined) return undefined;
  const [plan, found] = await Promise.all([
    deps.plans.findById(target.planId),
    deps.responses.findRemote(target.planId, request.actorId),
  ]);
  if (plan === undefined || found === undefined || found.response.kind !== "joined") {
    return undefined;
  }
  // Someone else's Note is not theirs to answer.
  if (target.recipient !== undefined && target.recipient !== found.response.id) return undefined;
  if (!isRecapOpen(plan, deps.clock.now())) return undefined;
  if (request.addressedTo.length === 0) return undefined;
  const exactStartNote = await actors.notes.find(found.response.id);
  const ours = new Set([
    INSTANCE_ACTOR,
    await attributedActor(deps, plan),
    ...(await actors.contributionNotes.listByRecipient(found.response.id)).map(
      (note) => note.localActor,
    ),
    ...(exactStartNote === undefined ? [] : [exactStartNote.localActor]),
  ]);
  if (!request.addressedTo.every((actor) => ours.has(actor))) return undefined;
  return { plan, response: found.response };
}

/**
 * Whether this actor is a joined participant of any plan: the cheap test before a Note is even
 * fetched; anyone else's replies are not for us.
 */
export async function isJoinedAnywhere(deps: PlanDeps, actorId: string): Promise<boolean> {
  if (deps.posterActors?.enabled !== true) return false;
  return (await deps.responses.listByRemoteActor(actorId)).some(
    (response) => response.kind === "joined",
  );
}

/** A new reply: a contribution by the author's response, fanned out to the others last. */
export async function addRemoteContribution(
  deps: PlanDeps,
  request: Reply,
): Promise<"added" | "ignored" | "limited"> {
  const found = await accepted(deps, request);
  const mappings = deps.posterActors?.remoteContributions;
  if (found === undefined || mappings === undefined) return "ignored";
  const { plan, response } = found;
  // The same Note again: nothing new.
  if ((await mappings.findContribution(response.id, request.noteId)) !== undefined) {
    return "ignored";
  }
  if ((await deps.recap.countByAuthor(plan.id, response.id)) >= CONTRIBUTION_LIMITS.perPerson) {
    return "ignored";
  }
  const checked = validateContribution(request);
  if (!checked.ok) return "ignored";
  // Plausible: the one place the sender's server's quota is spent.
  if (request.admit?.() === false) return "limited";
  const now = deps.clock.now();
  const contributionId = deps.ids.rowId();
  // The cap is checked in the same step as the insert: replies at once cannot exceed it.
  const created = await deps.recap.createWithinLimit(
    {
      id: contributionId,
      planId: plan.id,
      responseId: response.id,
      ...checked.value,
      hiddenByHost: false,
      createdAt: now,
      updatedAt: now,
    },
    CONTRIBUTION_LIMITS.perPerson,
  );
  if (!created) return "ignored";
  const stored = await mappings.create(
    { contributionId, responseId: response.id, planId: plan.id, remoteNoteId: request.noteId },
    now,
  );
  if (!stored) {
    // A concurrent copy of the same Note won the race. A publish or backfill may already have
    // sent this contribution: its Notes are withdrawn before it goes.
    await withdrawNotesOfContribution(deps, contributionId);
    await deps.recap.delete(contributionId);
    return "ignored";
  }
  await publishContribution(deps, plan, contributionId);
  return "added";
}

/** The author's `Update` of their own Note: same checks, their contribution only. */
export async function editRemoteContribution(
  deps: PlanDeps,
  request: Reply,
): Promise<"updated" | "ignored" | "limited"> {
  const found = await accepted(deps, request);
  const mappings = deps.posterActors?.remoteContributions;
  if (found === undefined || mappings === undefined) return "ignored";
  const { plan, response } = found;
  const contributionId = await mappings.findContribution(response.id, request.noteId);
  const contribution =
    contributionId === undefined ? undefined : await deps.recap.findById(contributionId);
  if (
    contribution === undefined ||
    contribution.planId !== plan.id ||
    contribution.responseId !== response.id
  ) {
    return "ignored";
  }
  const checked = validateContribution(request);
  if (!checked.ok) return "ignored";
  if (request.admit?.() === false) return "limited";
  await deps.recap.update({ ...contribution, ...checked.value, updatedAt: deps.clock.now() });
  await syncContributionNotes(deps, plan);
  return "updated";
}

/**
 * The author's `Delete` of their own Note: the contribution goes, as when its author deletes it,
 * with a `Delete` for what was sent to the others. Only the actor's own Notes are found.
 */
export async function deleteRemoteContribution(
  deps: PlanDeps,
  request: { actorId: string; noteId: string },
): Promise<"deleted" | "ignored"> {
  const mappings = deps.posterActors?.remoteContributions;
  if (deps.posterActors?.enabled !== true || mappings === undefined) return "ignored";
  for (const response of await deps.responses.listByRemoteActor(request.actorId)) {
    const contributionId = await mappings.findContribution(response.id, request.noteId);
    const contribution =
      contributionId === undefined ? undefined : await deps.recap.findById(contributionId);
    if (contribution === undefined || contribution.responseId !== response.id) continue;
    await withdrawNotesOfContribution(deps, contribution.id);
    await deps.recap.delete(contribution.id);
    return "deleted";
  }
  return "ignored";
}
