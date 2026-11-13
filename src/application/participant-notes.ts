// Private direct Notes to accepted remote participants (spec 7 ActivityPub; decision D43; 0.9 step
// 11b): a remote participant who joined gets the exact start and the route as a `Note` from the
// plan's attributed actor, addressed to them alone, with the GPX behind a secret link that exists
// only while the Note does. A change of exact start, route, start time or the plan's language is
// an `Update` of the same Note (a new link if the route changed, the old one revoked), none for
// an edit that changes none of these. The Note is withdrawn (`Delete`) when the participant leaves
// joined, in any way, and with the plan; cancelling a plan keeps it. Every `Update` and the
// `Delete` come from the actor that sent the `Create`, whatever the plan is attributed to by then,
// while that actor can still sign. Nothing is sent, and no link works, while federation is off.
// The Note's content is never kept: only keyed fingerprints.
import type { Plan } from "../domain/plan.ts";
import type { ResponseKind } from "../domain/response.ts";
import type { Route } from "../domain/route.ts";
import { activePublisher, attributedActor } from "./attribution.ts";
import type { PlanDeps } from "./plans.ts";
import { INSTANCE_ACTOR } from "./following.ts";
import type { ParticipantNote, ParticipantNoteFacts } from "./ports.ts";

type NoteDeps = Pick<PlanDeps, "posterActors" | "plans" | "responses" | "ids" | "tokens" | "clock">;

/** Keyed fingerprints of the route and of the rest, joined as "route\nrest". */
function fingerprints(deps: NoteDeps, plan: Plan, route: Route | undefined) {
  const notes = deps.posterActors?.notes;
  const point = plan.exactStart?.point;
  const rest = JSON.stringify([
    plan.exactStart?.description ?? null,
    point === undefined ? null : [point.lat, point.lng],
    plan.startsAt.toISOString(),
    plan.timeZone,
    plan.posterLanguage,
  ]);
  return {
    route: notes?.fingerprint(`route:${route === undefined ? "" : JSON.stringify(route)}`) ?? "",
    rest: notes?.fingerprint(`rest:${rest}`) ?? "",
  };
}

const parts = (hash: string) => {
  const [route = "", rest = ""] = hash.split("\n");
  return { route, rest };
};

/** Who sends for a Note: the actor that sent it, while it can sign; else the instance actor. */
async function senderOf(deps: NoteDeps, note: ParticipantNote): Promise<string> {
  if (note.localActor === INSTANCE_ACTOR) return INSTANCE_ACTOR;
  const actor = await deps.posterActors?.profiles.findActor(note.localActor);
  return actor?.kind === "active" ? note.localActor : INSTANCE_ACTOR;
}

function factsOf(
  plan: Plan,
  note: {
    noteId: string;
    responseId: string;
    routeToken: string | undefined;
    publishedAt: Date;
    updatedAt: Date | undefined;
  },
  localActor: string,
): ParticipantNoteFacts {
  return {
    noteId: note.noteId,
    planId: plan.id,
    responseId: note.responseId,
    localActor,
    language: plan.posterLanguage,
    title: plan.title,
    startsAt: plan.startsAt,
    timeZone: plan.timeZone,
    exactStart: plan.exactStart,
    routeToken: note.routeToken,
    publishedAt: note.publishedAt,
    updatedAt: note.updatedAt,
  };
}

/** The Note for a remote participant who just joined; nothing if there is nothing private to send. */
async function createNote(deps: NoteDeps, plan: Plan, responseId: string): Promise<void> {
  const publisher = activePublisher(deps);
  const notes = deps.posterActors?.notes;
  const remote = await deps.responses.remoteOf(responseId);
  if (publisher === undefined || notes === undefined || remote === undefined) return;
  if ((await notes.find(responseId)) !== undefined) return;
  const route = await deps.plans.findRoute(plan.id);
  if (plan.exactStart === undefined && route === undefined) return;
  const fp = fingerprints(deps, plan, route);
  const now = deps.clock.now();
  const localActor = await attributedActor(deps, plan);
  const note = {
    responseId,
    planId: plan.id,
    noteId: deps.ids.rowId(),
    localActor,
    routeToken: route === undefined ? undefined : deps.tokens.generate(),
    contentHash: `${fp.route}\n${fp.rest}`,
  };
  // Two attempts at once: only the one that stored the Note sends it.
  if (!(await notes.create(note, now))) return;
  await publisher.sendParticipantNote(
    "create",
    factsOf(plan, { ...note, publishedAt: now, updatedAt: undefined }, localActor),
    remote.actor,
  );
}

/**
 * The Note's `Delete`, and the end of its link, when a remote participant stops being joined or
 * goes. Queued first and the row removed after, so a failure to queue loses nothing; the row is
 * removed even where nothing can be sent (federation off).
 */
export async function withdrawNote(deps: NoteDeps, plan: Plan, responseId: string): Promise<void> {
  const notes = deps.posterActors?.notes;
  const note = await notes?.find(responseId);
  if (notes === undefined || note === undefined) return;
  const remote = await deps.responses.remoteOf(responseId);
  const publisher = activePublisher(deps);
  if (publisher !== undefined && remote !== undefined) {
    await publisher.withdrawParticipantNote(
      { noteId: note.noteId, planId: plan.id, localActor: await senderOf(deps, note) },
      remote.actor,
    );
  }
  await notes.delete(responseId);
}

/**
 * After a remote response changed kind (`was` undefined: it is new): the Note is sent once they
 * are joined, and withdrawn once they no longer are. Called after the answer is sent.
 */
export async function syncNoteOf(
  deps: NoteDeps,
  plan: Plan,
  responseId: string,
  was: ResponseKind | undefined,
  now: ResponseKind,
): Promise<void> {
  if (was === now) return;
  if (now === "joined") await createNote(deps, plan, responseId);
  else if (was === "joined") await withdrawNote(deps, plan, responseId);
}

/**
 * After a plan was edited or its route changed: an `Update` of each joined remote participant's
 * Note whose content changed; the route's link is replaced only if the route changed.
 */
export async function syncParticipantNotes(deps: NoteDeps, plan: Plan): Promise<void> {
  const publisher = activePublisher(deps);
  const notes = deps.posterActors?.notes;
  if (publisher === undefined || notes === undefined) return;
  const joined = (await deps.responses.listRemote(plan.id)).filter(
    (entry) => entry.response.kind === "joined",
  );
  if (joined.length === 0) return;
  const route = await deps.plans.findRoute(plan.id);
  // Nothing private is left (the route of a plan without an exact start): nothing to update.
  if (plan.exactStart === undefined && route === undefined) {
    for (const { response } of joined) await withdrawNote(deps, plan, response.id);
    return;
  }
  const fp = fingerprints(deps, plan, route);
  const now = deps.clock.now();
  for (const { response, actor } of joined) {
    const note = await notes.find(response.id);
    if (note === undefined) {
      await createNote(deps, plan, response.id);
      continue;
    }
    const before = parts(note.contentHash);
    if (before.route === fp.route && before.rest === fp.rest) continue;
    const sender = await senderOf(deps, note);
    const updated = {
      responseId: note.responseId,
      planId: note.planId,
      noteId: note.noteId,
      localActor: sender,
      // A changed route has a new link, and the old one stops working with the stored value.
      routeToken:
        before.route === fp.route
          ? note.routeToken
          : route === undefined
            ? undefined
            : deps.tokens.generate(),
      contentHash: `${fp.route}\n${fp.rest}`,
    };
    await notes.update(updated, now);
    await publisher.sendParticipantNote(
      "update",
      factsOf(plan, { ...updated, publishedAt: note.sentAt, updatedAt: now }, sender),
      actor,
    );
  }
}

/**
 * `Delete` for the Notes of a plan about to be deleted, read now, as the plan takes them along;
 * each from the actor that sent it.
 */
export async function withdrawNotesOfPlan(deps: NoteDeps, plan: Pick<Plan, "id">): Promise<void> {
  const publisher = activePublisher(deps);
  const notes = deps.posterActors?.notes;
  if (publisher === undefined || notes === undefined) return;
  for (const note of await notes.listByPlan(plan.id)) {
    const remote = await deps.responses.remoteOf(note.responseId);
    if (remote !== undefined) {
      await publisher.withdrawParticipantNote(
        { noteId: note.noteId, planId: plan.id, localActor: await senderOf(deps, note) },
        remote.actor,
      );
    }
    await notes.delete(note.responseId);
  }
}

/**
 * `Delete` for every Note a poster actor sent, signed while its keys still exist (they go with
 * the profile, so each job carries the key): when the profile is turned off or its account
 * deleted. The participants may not follow it, so the actor's own `Delete` does not reach them.
 */
export async function withdrawNotesOfActor(deps: NoteDeps, localActor: string): Promise<void> {
  const publisher = activePublisher(deps);
  const notes = deps.posterActors?.notes;
  if (notes === undefined) return;
  for (const note of await notes.listByActor(localActor)) {
    const remote = await deps.responses.remoteOf(note.responseId);
    if (publisher !== undefined && remote !== undefined) {
      await publisher.withdrawParticipantNote(
        { noteId: note.noteId, planId: note.planId, localActor },
        remote.actor,
        { carryKey: true },
      );
    }
    await notes.delete(note.responseId);
  }
}

/** The route behind a Note's secret link; nothing else is ever told about an unknown link. */
export async function routeForNoteLink(
  deps: NoteDeps,
  token: string,
): Promise<{ kind: "found"; title: string; route: Route } | { kind: "not_found" }> {
  const notes = deps.posterActors?.notes;
  if (deps.posterActors?.enabled !== true || notes === undefined) return { kind: "not_found" };
  const note = await notes.findByRouteToken(token);
  const plan = note === undefined ? undefined : await deps.plans.findById(note.planId);
  const route = plan === undefined ? undefined : await deps.plans.findRoute(plan.id);
  return plan === undefined || route === undefined
    ? { kind: "not_found" }
    : { kind: "found", title: plan.title, route };
}
