// Recap contributions over federation (spec 6 recap, 7 ActivityPub; decisions D44, D45; 0.9 step
// 12a): each visible contribution goes, with its author's name as web participants see it, as a
// direct `Note` `inReplyTo` the plan's `Event` to every remote participant who joined except its
// author, from the plan's attributed actor at that moment, addressed to that participant alone.
// Edits are an `Update` only when what the Note shows changed; the Note is withdrawn (`Delete`)
// whenever the web stops showing the contribution to that person: the author deleting it, the host
// hiding it or deleting the recap, the author's response going, the recipient no longer being
// joined, the plan being cancelled or deleted. A participant who joins later gets the newest 50
// visible contributions. Every `Update` and `Delete` come from the actor that sent the `Create`,
// while it can sign. Nothing is sent while federation is off. Content is never kept: only a keyed
// fingerprint.
import type { Plan } from "../domain/plan.ts";
import { hasRecap, type RecapContribution } from "../domain/recap.ts";
import type { PlanResponse } from "../domain/response.ts";
import { activePublisher, attributedActor, senderOf } from "./attribution.ts";
import type { PlanDeps } from "./plans.ts";
import type {
  ContributionNote,
  ContributionNoteFacts,
  ContributionNoteRepository,
  RemoteActor,
} from "./ports.ts";

type ContributionDeps = Pick<
  PlanDeps,
  "posterActors" | "plans" | "responses" | "recap" | "ids" | "clock"
>;

/** What withdrawing Notes needs: no contribution is read. */
type WithdrawDeps = Pick<PlanDeps, "posterActors" | "responses">;

/** A late joiner is sent at most this many of the existing contributions: the newest. */
export const BACKFILL_LIMIT = 50;

interface Recipient {
  response: PlanResponse;
  actor: RemoteActor;
}

/** Remote participants who joined: the only ones who receive contributions. */
async function joinedRecipients(deps: ContributionDeps, planId: string): Promise<Recipient[]> {
  return (await deps.responses.listRemote(planId))
    .filter((entry) => entry.response.kind === "joined")
    .map(({ response, actor }) => ({ response, actor }));
}

/** The author's name as web participants see it: the host's, or the response's. */
async function nameLookup(
  deps: ContributionDeps,
  plan: Plan,
): Promise<(contribution: RecapContribution) => string | undefined> {
  const names = new Map(
    (await deps.responses.listByPlan(plan.id)).map((response) => [
      response.id,
      response.displayName,
    ]),
  );
  return (contribution) =>
    contribution.responseId === undefined ? plan.posterName : names.get(contribution.responseId);
}

const fingerprintOf = (
  notes: ContributionNoteRepository,
  plan: Plan,
  authorName: string,
  contribution: RecapContribution,
): string =>
  notes.fingerprint(
    JSON.stringify([
      plan.posterLanguage,
      authorName,
      contribution.body ?? null,
      contribution.linkUrl ?? null,
    ]),
  );

function factsOf(
  plan: Plan,
  note: { noteId: string; responseId: string; localActor: string },
  contribution: RecapContribution,
  authorName: string,
  when: { publishedAt: Date; updatedAt: Date | undefined },
): ContributionNoteFacts {
  return {
    noteId: note.noteId,
    planId: plan.id,
    contributionId: contribution.id,
    responseId: note.responseId,
    localActor: note.localActor,
    language: plan.posterLanguage,
    authorName,
    body: contribution.body,
    linkUrl: contribution.linkUrl,
    ...when,
  };
}

/** The `Create` of one contribution's Note to one recipient, once: only the attempt that stores it sends. */
async function sendNew(
  deps: ContributionDeps,
  plan: Plan,
  contribution: RecapContribution,
  authorName: string,
  recipient: Recipient,
  localActor: string,
): Promise<void> {
  const publisher = activePublisher(deps);
  const notes = deps.posterActors?.contributionNotes;
  if (publisher === undefined || notes === undefined) return;
  if ((await notes.find(contribution.id, recipient.response.id)) !== undefined) return;
  const now = deps.clock.now();
  const note = {
    noteId: deps.ids.rowId(),
    contributionId: contribution.id,
    responseId: recipient.response.id,
    planId: plan.id,
    localActor,
    contentHash: fingerprintOf(notes, plan, authorName, contribution),
  };
  // Two attempts at once: only the one that stored the Note sends it.
  if (!(await notes.create(note, now))) return;
  await publisher.sendContributionNote(
    "create",
    factsOf(plan, note, contribution, authorName, { publishedAt: now, updatedAt: undefined }),
    recipient.actor,
  );
}

/**
 * A contribution that is new, or shown again by the host: its Note to every joined remote
 * participant but its author, if the web shows it (not hidden, the recap there). Last in its use
 * case.
 */
export async function publishContribution(
  deps: ContributionDeps,
  plan: Plan,
  contributionId: string,
): Promise<void> {
  if (activePublisher(deps) === undefined || deps.posterActors?.contributionNotes === undefined) {
    return;
  }
  if (!hasRecap(plan, deps.clock.now())) return;
  const contribution = await deps.recap.findById(contributionId);
  if (contribution === undefined || contribution.planId !== plan.id || contribution.hiddenByHost) {
    return;
  }
  const recipients = await joinedRecipients(deps, plan.id);
  if (recipients.length === 0) return;
  const authorName = (await nameLookup(deps, plan))(contribution);
  if (authorName === undefined) return;
  const localActor = await attributedActor(deps, plan);
  for (const recipient of recipients) {
    if (recipient.response.id === contribution.responseId) continue;
    await sendNew(deps, plan, contribution, authorName, recipient, localActor);
  }
}

/**
 * A remote participant who just joined (or whose Notes were withdrawn with a profile): the
 * existing visible contributions of others as direct Notes, oldest first, the newest 50 at most
 * (decision D45). Those already sent are not sent again.
 */
export async function backfillContributions(
  deps: ContributionDeps,
  plan: Plan,
  responseId: string,
): Promise<void> {
  if (activePublisher(deps) === undefined || deps.posterActors?.contributionNotes === undefined) {
    return;
  }
  if (!hasRecap(plan, deps.clock.now())) return;
  const recipient = (await joinedRecipients(deps, plan.id)).find(
    (candidate) => candidate.response.id === responseId,
  );
  if (recipient === undefined) return;
  const nameOf = await nameLookup(deps, plan);
  const wanted = (await deps.recap.listByPlan(plan.id)).flatMap((contribution) => {
    const authorName = nameOf(contribution);
    return contribution.hiddenByHost ||
      contribution.responseId === responseId ||
      authorName === undefined
      ? []
      : [{ contribution, authorName }];
  });
  if (wanted.length === 0) return;
  const localActor = await attributedActor(deps, plan);
  for (const { contribution, authorName } of wanted.slice(-BACKFILL_LIMIT)) {
    await sendNew(deps, plan, contribution, authorName, recipient, localActor);
  }
}

/**
 * After a contribution, an author's name or the plan changed: an `Update` of each Note whose
 * content (author's name, text, link, language) is no longer what was sent.
 */
export async function syncContributionNotes(deps: ContributionDeps, plan: Plan): Promise<void> {
  const publisher = activePublisher(deps);
  const notes = deps.posterActors?.contributionNotes;
  if (publisher === undefined || notes === undefined) return;
  const existing = await notes.listByPlan(plan.id);
  if (existing.length === 0) return;
  const contributions = new Map(
    (await deps.recap.listByPlan(plan.id)).map((contribution) => [contribution.id, contribution]),
  );
  const nameOf = await nameLookup(deps, plan);
  const now = deps.clock.now();
  for (const note of existing) {
    const contribution = contributions.get(note.contributionId);
    const authorName = contribution === undefined ? undefined : nameOf(contribution);
    // Hidden by the host: the Note is about to be withdrawn, an edit now must not reach it.
    if (contribution === undefined || contribution.hiddenByHost || authorName === undefined) {
      continue;
    }
    const contentHash = fingerprintOf(notes, plan, authorName, contribution);
    if (contentHash === note.contentHash) continue;
    const recipient = await deps.responses.remoteOf(note.responseId);
    if (recipient === undefined) continue;
    const localActor = await senderOf(deps, note);
    await notes.update({ noteId: note.noteId, localActor, contentHash }, now);
    await publisher.sendContributionNote(
      "update",
      factsOf(plan, { ...note, localActor }, contribution, authorName, {
        publishedAt: note.sentAt,
        updatedAt: now,
      }),
      recipient.actor,
    );
  }
}

/**
 * `Delete` for each Note, then the row: queued first, so a failure to queue loses nothing; the row
 * is removed even where nothing can be sent (federation off). Each from the actor that sent the
 * Note, or, for a profile being retired (`carryKey`), from that actor with its key in the job.
 */
async function withdraw(
  deps: WithdrawDeps,
  notes: readonly ContributionNote[],
  options: { carryKey: boolean } = { carryKey: false },
): Promise<void> {
  const repository = deps.posterActors?.contributionNotes;
  if (repository === undefined) return;
  const publisher = activePublisher(deps);
  for (const note of notes) {
    const recipient =
      publisher === undefined ? undefined : await deps.responses.remoteOf(note.responseId);
    if (publisher !== undefined && recipient !== undefined) {
      await publisher.withdrawContributionNote(
        {
          noteId: note.noteId,
          planId: note.planId,
          localActor: options.carryKey ? note.localActor : await senderOf(deps, note),
        },
        recipient.actor,
        options.carryKey ? { carryKey: true } : undefined,
      );
    }
    await repository.delete(note.noteId);
  }
}

/** The Notes of one contribution, before it is deleted or hidden. */
export async function withdrawNotesOfContribution(
  deps: WithdrawDeps,
  contributionId: string,
): Promise<void> {
  const notes = deps.posterActors?.contributionNotes;
  if (notes !== undefined) await withdraw(deps, await notes.listByContribution(contributionId));
}

/** The Notes of everything one response wrote, before its contributions go with it. */
export async function withdrawNotesOfAuthor(
  deps: ContributionDeps,
  plan: Pick<Plan, "id">,
  responseId: string,
): Promise<void> {
  const notes = deps.posterActors?.contributionNotes;
  if (notes === undefined) return;
  const authored = new Set(
    (await deps.recap.listByPlan(plan.id))
      .filter((contribution) => contribution.responseId === responseId)
      .map((contribution) => contribution.id),
  );
  if (authored.size === 0) return;
  await withdraw(
    deps,
    (await notes.listByPlan(plan.id)).filter((note) => authored.has(note.contributionId)),
  );
}

/** Every contribution Note of a plan: the recap deleted, the plan cancelled or about to be deleted. */
export async function withdrawNotesOfPlanContributions(
  deps: WithdrawDeps,
  plan: Pick<Plan, "id">,
): Promise<void> {
  const notes = deps.posterActors?.contributionNotes;
  if (notes !== undefined) await withdraw(deps, await notes.listByPlan(plan.id));
}

/** What was sent to one recipient, when they stop being joined or go. */
export async function withdrawNotesSentTo(deps: WithdrawDeps, responseId: string): Promise<void> {
  const notes = deps.posterActors?.contributionNotes;
  if (notes !== undefined) await withdraw(deps, await notes.listByRecipient(responseId));
}

/**
 * Every contribution Note a poster actor sent, each job carrying the actor's key (it is gone by
 * delivery), when its profile is turned off or its account deleted.
 */
export async function withdrawContributionNotesOfActor(
  deps: WithdrawDeps,
  localActor: string,
): Promise<void> {
  const notes = deps.posterActors?.contributionNotes;
  if (notes !== undefined)
    await withdraw(deps, await notes.listByActor(localActor), { carryKey: true });
}

/**
 * After a profile was turned off and its Notes withdrawn: the plan's joined participants get the
 * contributions again from the plan's attributed actor, the instance (new Notes, new identifiers).
 */
export async function resendContributionNotes(deps: ContributionDeps, plan: Plan): Promise<void> {
  for (const recipient of await joinedRecipients(deps, plan.id)) {
    await backfillContributions(deps, plan, recipient.response.id);
  }
}
