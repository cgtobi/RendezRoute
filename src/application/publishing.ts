// Plans in the fediverse (spec 7 ActivityPub; decisions D35, D37, D38, D39): a followers or public
// plan saved under the fediverse wording goes to its owner's followers from the owner's actor
// (`Create`); edits that change what its `Event` shows, and cancelling, send `Update`; widening
// followers to public sends `Update` with the new audience; narrowing, or deleting the plan in
// any way, sends `Delete` to the audience that got it, and a withdrawn plan is never sent again.
// Only a poster's profile shares plans: the instance actor publishes nothing (D39), except to the
// plan's remote participants, who get its `Update` (while still in) and `Delete` (all who joined)
// whatever its visibility, from the plan's attributed actor, each in an activity addressed to
// them alone (D42); narrowing a plan does not `Delete` it for them.
import type { Plan } from "../domain/plan.ts";
import { planActor } from "./fediverse-profile.ts";
import { eventViewOf } from "./plan-views.ts";
import { attributedActor } from "./attribution.ts";
import { withdrawNotesOfPlanContributions } from "./contribution-notes.ts";
import { withdrawNotesOfPlan } from "./participant-notes.ts";
import { remoteAudience, remoteReach } from "./remote-participants.ts";
import type { PlanDeps } from "./plans.ts";
import type {
  FederationPublisher,
  PlanPublication,
  PublicationRepository,
  RemoteActor,
} from "./ports.ts";

type PublishDeps = Pick<
  PlanDeps,
  "posterActors" | "plans" | "clock" | "responses" | "recap" | "ids" | "tokens"
>;

/** Where the plan should be in the fediverse now: by whom, to whom; undefined for nowhere. */
async function intendedPublication(
  deps: PublishDeps,
  plan: Plan,
): Promise<PlanPublication | undefined> {
  if (plan.visibility === "link") return undefined;
  const localActor = await planActor(deps, plan);
  return localActor === undefined
    ? undefined
    : { planId: plan.id, localActor, audience: plan.visibility };
}

/** Whether the plan's `Event` would read differently. */
function eventChanged(before: Plan, after: Plan): boolean {
  return JSON.stringify(eventViewOf(before)) !== JSON.stringify(eventViewOf(after));
}

/**
 * After a plan was stored, created (`before` undefined) or changed: sends what the fediverse
 * needs to know, while federation is on.
 */
export async function syncPublication(
  deps: PublishDeps,
  before: Plan | undefined,
  after: Plan,
): Promise<void> {
  const actors = deps.posterActors;
  const publisher = actors?.publisher;
  if (actors?.enabled !== true || publisher === undefined) return;
  // Remote participants hear of every change to the `Event`, whatever its visibility (D42).
  const participants =
    before !== undefined && eventChanged(before, after) ? await remoteReach(deps, after.id) : [];
  await syncFollowers(deps, before, after);
  // Their own activity each, whether or not the plan also went to followers: addressed to nobody
  // else, so no server learns who took part (spec 3.6).
  if (participants.length > 0) {
    await publisher.updateForParticipants(
      {
        planId: after.id,
        // After the followers' part, which may have withdrawn the plan: who it is attributed to now.
        localActor: await attributedActor(deps, after),
        event: eventViewOf(after),
        language: after.posterLanguage,
      },
      participants,
    );
  }
}

/** The part for the owner's followers. */
async function syncFollowers(
  deps: PublishDeps,
  before: Plan | undefined,
  after: Plan,
): Promise<void> {
  const actors = deps.posterActors;
  const publisher = actors?.publisher;
  if (actors === undefined || publisher === undefined) return;
  const state = await actors.publications.find(after.id);
  if (state.kind === "withdrawn") return;
  const now = deps.clock.now();
  const target = await intendedPublication(deps, after);
  const followersOf = (localActor: string) => actors.followers.list(localActor);
  const send = async (activity: "create" | "update", publication: PlanPublication) => {
    await publisher.sendPlan(
      activity,
      { ...publication, event: eventViewOf(after), language: after.posterLanguage },
      await followersOf(publication.localActor),
    );
    await actors.publications.publish(publication, now);
  };

  if (state.kind === "none") {
    // Only a plan people can still come to is announced; a cancelled or past one never was.
    const upcoming = after.status === "active" && after.startsAt > now;
    if (target !== undefined && upcoming) await send("create", target);
    return;
  }
  const { kind: _, ...current } = state;
  const widened = current.audience === "followers" && target?.audience === "public";
  const narrowed = current.audience === "public" && target?.audience === "followers";
  if (target === undefined || target.localActor !== current.localActor || narrowed) {
    // Narrowed, to followers or link-only, or no longer the owner's to share: gone for good (D39).
    // Not for the participants: they keep the plan (D42).
    await withdraw(
      { publisher, publications: actors.publications },
      { publication: current, followers: await followersOf(current.localActor), now },
    );
  } else if (widened || (before !== undefined && eventChanged(before, after))) {
    await send("update", target);
  }
}

/**
 * Before plans are deleted, by anyone and any path: `Delete` for those in the fediverse, and for
 * their remote participants, whatever the visibility (D42); they are read now, as they go too.
 */
export async function withdrawDeletedPlans(
  deps: PublishDeps,
  plans: readonly Pick<Plan, "id" | "federatedAt">[],
): Promise<void> {
  const actors = deps.posterActors;
  const publisher = actors?.publisher;
  if (actors?.enabled !== true || publisher === undefined) return;
  const published = await actors.publications.findPublished(plans.map((plan) => plan.id));
  const now = deps.clock.now();
  // Each actor's followers read once, however many of its plans go (a sweep, an account).
  const followers = new Map<string, readonly RemoteActor[]>();
  for (const plan of plans) {
    // Everyone who joined, also the rejected and removed, whose servers hold the `Event` too.
    const participants = await remoteAudience(deps, plan.id);
    const publication = published.find((candidate) => candidate.planId === plan.id);
    if (publication !== undefined) {
      const actor = publication.localActor;
      if (!followers.has(actor)) followers.set(actor, await actors.followers.list(actor));
      await withdraw(
        { publisher, publications: actors.publications },
        {
          publication,
          followers: followers.get(actor) ?? [],
          now,
        },
      );
    }
    // Their private Notes, read before the plan and the responses go (decision D43).
    await withdrawNotesOfPlan(deps, plan);
    // And of its contributions, which the plan takes along (decision D44).
    await withdrawNotesOfPlanContributions(deps, plan);
    if (participants.length > 0) {
      await publisher.deleteForParticipants(
        {
          planId: plan.id,
          // The plan's actor, or the instance's where it was withdrawn or never shared.
          localActor: publication?.localActor ?? (await attributedActor(deps, plan)),
        },
        participants,
      );
    }
  }
}

/** `Delete` to the audience that got the plan; never sent again (D39). */
async function withdraw(
  {
    publisher,
    publications,
  }: { publisher: FederationPublisher; publications: PublicationRepository },
  {
    publication,
    followers,
    now,
  }: { publication: PlanPublication; followers: readonly RemoteActor[]; now: Date },
): Promise<void> {
  await publisher.withdrawPlan(publication, followers);
  await publications.withdraw(publication.planId, now);
}
