// Remote participants (spec 7 ActivityPub, 3.7; decision D42; 0.9 step 11a): a remote actor's
// `Join` or `TentativeAccept` of a plan becomes a response like a web one, joined, requested (in
// approval mode, decided later by the host) or interested, answered with `Accept` or `Reject`; its
// `Undo` removes it, and the actor's `Delete` removes everything of it. A plan's `Update` and
// `Delete` reach these people whatever its visibility. Answers and changes come from the plan's
// attributed actor: the poster's actor while its profile shares the plan, else the instance actor.
// Nothing is sent while federation is off. The actor's address is stored encrypted.
import type { Plan } from "../domain/plan.ts";
import type { ResponseChoice } from "../domain/requests.ts";
import { isBlocked, type PlanResponse, type ResponseKind } from "../domain/response.ts";
import { canRespond, validateDisplayName } from "../domain/responding.ts";
import { planActor } from "./fediverse-profile.ts";
import { inboxesOnOwnServer, INSTANCE_ACTOR } from "./following.ts";
import { notifyHostOfArrival } from "./notify.ts";
import type { PlanDeps } from "./plans.ts";
import type { FederationPublisher, RemoteActor, RemoteJoin } from "./ports.ts";
import { withdrawResponse } from "./responses.ts";

/** Those a plan's changes concern: remote people still in, not the rejected or removed. */
const STILL_IN: ReadonlySet<ResponseKind> = new Set(["interested", "requested", "joined"]);

/** The publisher, while federation is on. */
export function activePublisher(
  deps: Pick<PlanDeps, "posterActors">,
): FederationPublisher | undefined {
  const actors = deps.posterActors;
  return actors?.enabled === true ? actors.publisher : undefined;
}

/**
 * Who a plan is attributed to now: the poster's actor while it shares the plan, the instance
 * actor otherwise, also for a plan withdrawn from the fediverse (decisions D39, D42), as its
 * `Event` names it.
 */
export async function attributedActor(
  deps: Pick<PlanDeps, "posterActors" | "plans">,
  plan: { id: string; federatedAt: Date | undefined },
): Promise<string> {
  const state = await deps.posterActors?.publications.find(plan.id);
  if (state?.kind === "published") return state.localActor;
  if (state?.kind === "withdrawn") return INSTANCE_ACTOR;
  return (await planActor(deps, plan)) ?? INSTANCE_ACTOR;
}

/** The remote people a plan's `Update` reaches, read before the plan can be deleted. */
export async function remoteReach(
  deps: Pick<PlanDeps, "responses">,
  planId: string,
): Promise<RemoteActor[]> {
  const remote = await deps.responses.listRemote(planId);
  return remote.filter((entry) => STILL_IN.has(entry.response.kind)).map((entry) => entry.actor);
}

/**
 * Everyone who joined from the fediverse, also those rejected or removed: their servers hold the
 * `Event` too, so the plan's `Delete` reaches them all.
 */
export async function remoteAudience(
  deps: Pick<PlanDeps, "responses">,
  planId: string,
): Promise<RemoteActor[]> {
  return (await deps.responses.listRemote(planId)).map((entry) => entry.actor);
}

/** At most this many remote responses to one plan from one server; more are rejected. */
export const MAX_REMOTE_PER_ORIGIN = 50;

export type JoinRemoteResult =
  /** Stored or already known; answered where the plan's rules allow. */
  | "stored"
  /** Not taken (cancelled, started, blocked): `Reject` was sent. */
  | "rejected"
  /** Nothing done, nothing sent. */
  | "ignored";

/** Without invisible and direction-changing characters, which could disguise a name. */
const plain = (text: string | undefined): string =>
  (text ?? "").replace(/[\p{Cf}\p{Cc}]/gu, "").trim();

/**
 * The name shown to the host and the participants, as the web form would take it:
 * `username@server`, else the actor's name, else its server. A username with an `@` or a space
 * could pass for another address, so it is not used.
 */
function shownName(
  plan: Plan,
  actor: RemoteActor,
  names: { username?: string | undefined; name?: string | undefined },
): string {
  const host = new URL(actor.id).hostname;
  const username = plain(names.username);
  const address = username === "" || /[@\s]/u.test(username) ? "" : `${username}@${host}`;
  for (const candidate of [address, plain(names.name), host]) {
    const valid = validateDisplayName(candidate, plan.posterName);
    if (valid.ok) return valid.value;
  }
  return "fediverse";
}

/**
 * A `Join` (joined, or requested in approval mode) or `TentativeAccept` (interested) of a plan by
 * a remote actor. Any plan that takes web responses takes it, whatever its visibility; a
 * cancelled or started plan, or a blocked actor, is answered with `Reject`. A repeated one changes
 * nothing; a changed mind changes the response. An unknown plan gets no answer at all.
 */
export async function joinRemote(
  deps: PlanDeps,
  request: {
    planId: string;
    join: RemoteJoin;
    actor: RemoteActor;
    /** As the actor's profile gives them (`preferredUsername`, `name`). */
    username?: string | undefined;
    name?: string | undefined;
    /**
     * Asked only when the host is due a notice, with the kind of response (joined, requested,
     * interested); false when the actor, or the plan, has notified the host too often lately.
     */
    mayNotifyHost: (kind: ResponseChoice) => boolean;
  },
): Promise<JoinRemoteResult> {
  const publisher = activePublisher(deps);
  const plan = await deps.plans.findById(request.planId);
  // Our signed answers must not be pointed at another server (as for follows, D38).
  if (publisher === undefined || plan === undefined || !inboxesOnOwnServer(request.actor)) {
    return "ignored";
  }
  const sender = await attributedActor(deps, plan);
  const answer = (kind: "accept" | "reject", responseId: string | undefined) =>
    publisher.answerJoin(
      kind,
      { localActor: sender, planId: plan.id, responseId },
      { actor: request.actor, join: request.join },
    );

  const now = deps.clock.now();
  const existing = await deps.responses.findRemote(plan.id, request.actor.id);
  if (existing !== undefined && isBlocked(existing.response.kind)) {
    await answer("reject", existing.response.id);
    return "rejected";
  }
  const kind: ResponseChoice =
    request.join.kind === "tentative"
      ? "interested"
      : existing?.response.kind === "joined" || plan.joinMode === "open"
        ? "joined"
        : "requested";
  if (existing?.response.kind === kind) {
    // Heard before: answered as it stands, in case the first answer was lost, and named by the
    // latest activity, which an `Undo` may undo.
    if (existing.join.id !== request.join.id) {
      await deps.responses.updateRemote({ ...existing, join: request.join });
    }
    if (kind !== "requested") await answer("accept", existing.response.id);
    return "stored";
  }
  if (!canRespond(plan, now).ok) {
    await answer("reject", existing?.response.id);
    return "rejected";
  }
  // One server cannot fill a plan with responses.
  if (existing === undefined) {
    const origin = new URL(request.actor.id).origin;
    const same = (await deps.responses.listRemote(plan.id)).filter(
      (entry) => new URL(entry.actor.id).origin === origin,
    );
    if (same.length >= MAX_REMOTE_PER_ORIGIN) {
      await answer("reject", undefined);
      return "rejected";
    }
  }

  let responseId = existing?.response.id;
  if (existing !== undefined) {
    await deps.responses.updateRemote({
      ...existing,
      join: request.join,
      response: { ...existing.response, kind, requestNote: undefined, updatedAt: now },
    });
  } else {
    const response: PlanResponse = {
      id: deps.ids.rowId(),
      planId: plan.id,
      kind,
      displayName: shownName(plan, request.actor, request),
      language: plan.posterLanguage,
      previousKind: undefined,
      createdAt: now,
      updatedAt: now,
    };
    responseId = response.id;
    try {
      await deps.responses.createRemote({
        response,
        actor: request.actor,
        join: request.join,
        // Nobody holds the token: the actor cannot manage its response on the web.
        manageTokenHash: deps.tokens.hash(deps.tokens.generate()),
      });
    } catch (error) {
      // A concurrent copy of the same `Join` won the race (one response per actor and plan).
      if ((await deps.responses.findRemote(plan.id, request.actor.id)) !== undefined) {
        return "stored";
      }
      throw error;
    }
  }
  // News for the host: a new response, or a change to joining or requesting (as on the web).
  if ((existing === undefined || kind !== "interested") && request.mayNotifyHost(kind)) {
    await notifyHostOfArrival(deps, plan, kind);
  }
  // Last: the answer is sent only once the response is stored.
  if (kind !== "requested") await answer("accept", responseId);
  return "stored";
}

/**
 * An `Undo` of the actor's own `Join` or `TentativeAccept` (`joinId`: the one undone), or its
 * `Leave`: the response is deleted; a block on it stays. An `Undo` of an answer the actor has
 * since replaced by another changes nothing.
 */
export async function leaveRemote(
  deps: PlanDeps,
  request: { planId: string; actorId: string; joinId?: string | undefined },
): Promise<boolean> {
  const found = await deps.responses.findRemote(request.planId, request.actorId);
  const plan = await deps.plans.findById(request.planId);
  if (found === undefined || plan === undefined || isBlocked(found.response.kind)) return false;
  if (request.joinId !== undefined && request.joinId !== found.join.id) return false;
  await withdrawResponse(deps, plan, found.response);
  return true;
}

/** The actor was deleted on its server: everything of it goes, in every plan (spec 3.7). */
export async function forgetRemoteParticipant(deps: PlanDeps, actorId: string): Promise<number> {
  const responses = await deps.responses.listByRemoteActor(actorId);
  for (const response of responses) {
    const plan = await deps.plans.findById(response.planId);
    if (plan !== undefined) await withdrawResponse(deps, plan, response);
  }
  return responses.length;
}

/**
 * Tells a remote participant what the host decided, after it was stored; nothing for a response
 * made on the web, or while federation is off.
 */
export async function answerRemoteResponse(
  deps: PlanDeps,
  plan: Plan,
  response: PlanResponse,
  answer: "accept" | "reject",
): Promise<void> {
  const publisher = activePublisher(deps);
  if (publisher === undefined) return;
  const remote = await deps.responses.remoteOf(response.id);
  if (remote === undefined) return;
  await publisher.answerJoin(
    answer,
    { localActor: await attributedActor(deps, plan), planId: plan.id, responseId: response.id },
    remote,
  );
}
