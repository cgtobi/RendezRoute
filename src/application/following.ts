// Following the instance's actors (spec 7 ActivityPub; decision D38): anyone in the fediverse may
// follow the instance actor or a poster's active actor, accepted at once; unfollowing, or the
// follower's account being deleted on its server, removes them. Followers are counted, never
// listed. Retiring a poster actor tells its followers (fediverse-profile.ts).
import type { PlanDeps } from "./plans.ts";
import type { RemoteActor } from "./ports.ts";

/** The instance actor's identifier in its URI (`/actors/instance`). */
export const INSTANCE_ACTOR = "instance";

type FollowDeps = Pick<PlanDeps, "posterActors" | "clock">;

/** Whether the local actor can be followed: the instance actor, or an active poster actor. */
export async function isFollowable(deps: FollowDeps, localActor: string): Promise<boolean> {
  const actors = deps.posterActors;
  if (actors?.enabled !== true) return false;
  if (localActor === INSTANCE_ACTOR) return true;
  return (await actors.profiles.findActor(localActor))?.kind === "active";
}

/**
 * A `Follow` of a local actor: stored and answered with `Accept`; ignored for an actor that does
 * not exist, or a follower whose inboxes are not on its own server, as nobody may point this
 * instance's signed deliveries at someone else.
 */
export async function followActor(
  deps: FollowDeps,
  request: { localActor: string; followId: string; follower: RemoteActor },
): Promise<"accepted" | "unknown_actor" | "elsewhere"> {
  const actors = deps.posterActors;
  if (actors === undefined || !(await isFollowable(deps, request.localActor))) {
    return "unknown_actor";
  }
  if (!inboxesOnOwnServer(request.follower)) return "elsewhere";
  await actors.followers.add(request.localActor, request.follower, deps.clock.now());
  await actors.publisher?.acceptFollow(request.localActor, {
    id: request.followId,
    follower: request.follower,
  });
  return "accepted";
}

/** An `Undo` of a `Follow`: the remote actor no longer follows the local one. */
export async function unfollowActor(
  deps: FollowDeps,
  request: { localActor: string; remoteActorId: string },
): Promise<void> {
  await deps.posterActors?.followers.remove(request.localActor, request.remoteActorId);
}

/** A remote actor deleted on its server follows nobody here any more (spec 3.7). */
export async function forgetRemoteActor(deps: FollowDeps, remoteActorId: string): Promise<number> {
  return (await deps.posterActors?.followers.forget(remoteActorId)) ?? 0;
}

/** Followers while federation is off: forgotten, as nothing can reach them (housekeeping). */
export async function forgetFollowersWhileOff(deps: FollowDeps): Promise<number> {
  const actors = deps.posterActors;
  return actors === undefined || actors.enabled ? 0 : actors.followers.clear();
}

/** How many follow a local actor: the only thing shown about followers. */
export async function followerCount(deps: FollowDeps, localActor: string): Promise<number> {
  return (await deps.posterActors?.followers.count(localActor)) ?? 0;
}

function inboxesOnOwnServer(actor: RemoteActor): boolean {
  const origin = originOf(actor.id);
  return (
    origin !== undefined &&
    originOf(actor.inbox) === origin &&
    (actor.sharedInbox === undefined || originOf(actor.sharedInbox) === origin)
  );
}

const originOf = (url: string): string | undefined =>
  URL.canParse(url) ? new URL(url).origin : undefined;
