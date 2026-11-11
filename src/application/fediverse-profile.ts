// A poster's fediverse profile (spec 7 ActivityPub; decisions D36, D37): turned on from the account
// page with a handle chosen once (suggested from the display name), which makes the account's
// actor discoverable in the fediverse; turned off, or with the account deleted, the account's
// followers plans become link-only, none of its plans is shared any more, and the actor is retired
// for good.
import type { ActivityType } from "../domain/activity.ts";
import { suggestHandle, validateHandle } from "../domain/actor.ts";
import type { AccountDeps } from "./accounts.ts";
import { accountOf } from "./channel-links.ts";
import type { PlanDeps } from "./plans.ts";
import type { IdentityRepository } from "./ports.ts";

type Unavailable = { kind: "unavailable" };
const UNAVAILABLE: Unavailable = { kind: "unavailable" };

export type ProfileSetting =
  | Unavailable
  /** No profile yet: the handle the form suggests. */
  | { kind: "off"; suggestion: string }
  /** On, with how many follow it in the fediverse (decision D38). */
  | { kind: "on"; handle: string; followers: number };

/** What the account page shows; nothing while federation is off or nobody is logged in. */
export async function profileSetting(
  deps: AccountDeps,
  request: { deviceToken: string | undefined },
): Promise<ProfileSetting> {
  const actors = deps.posterActors;
  const account = await accountOf(deps, request.deviceToken);
  if (actors?.enabled !== true || account === undefined) return UNAVAILABLE;
  const profile = await actors.profiles.findActive(account.identityId);
  if (profile !== undefined) {
    return {
      kind: "on",
      handle: profile.handle,
      followers: await actors.followers.count(profile.id),
    };
  }
  const identity = await deps.identities.findById(account.identityId);
  return { kind: "off", suggestion: suggestHandle(identity?.displayName ?? "") };
}

export type CreateProfileResult =
  | Unavailable
  | { kind: "created"; handle: string }
  | { kind: "invalid"; code: "handle_invalid" | "handle_reserved" | "handle_taken" };

/** Turns the profile on: the actor exists from now on, with keys of its own (decision D36). */
export async function createProfile(
  deps: PlanDeps,
  request: { deviceToken: string | undefined; handle: string },
): Promise<CreateProfileResult> {
  const actors = deps.posterActors;
  const account = await accountOf(deps, request.deviceToken);
  if (actors?.enabled !== true || account === undefined) return UNAVAILABLE;
  const handle = validateHandle(request.handle);
  if (!handle.ok) return { kind: "invalid", code: handle.error };
  const wanted = { identityId: account.identityId, handle: handle.value };
  // Checked before the keys are made, which takes a while; checked again as it is stored.
  if (await actors.profiles.isTaken(wanted)) return { kind: "invalid", code: "handle_taken" };
  const created = await actors.profiles.create({
    ...wanted,
    id: deps.ids.planId(),
    createdAt: deps.clock.now(),
    keys: await actors.actorKeys.generate(),
  });
  return created === "created"
    ? { kind: "created", handle: handle.value }
    : { kind: "invalid", code: "handle_taken" };
}

/** Turns the profile off for good (decision D37); its followers plans become link-only. */
export async function retireProfile(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<Unavailable | { kind: "retired"; plansNowLinkOnly: number }> {
  const account = await accountOf(deps, request.deviceToken);
  if (account === undefined || deps.posterActors === undefined) return UNAVAILABLE;
  return {
    kind: "retired",
    plansNowLinkOnly: await retireAccountProfile(deps, account.identityId),
  };
}

/**
 * Retires the account's profile, if any: when turned off and before the account is deleted (the
 * database refuses deleting an account whose profile is active). Its followers plans become
 * link-only, and none of its plans counts as shared any more, so a later profile shares only what
 * is saved under its own handle (D35); its followers are told the actor is gone (`Delete`, signed
 * while its keys still exist) and forgotten (D38). The plans come first and the profile last, so
 * a retry after a failure finishes the job. Returns how many plans became link-only.
 */
export async function retireAccountProfile(deps: PlanDeps, identityId: string): Promise<number> {
  const actors = deps.posterActors;
  if (actors === undefined) return 0;
  const now = deps.clock.now();
  let changed = 0;
  for (const { plan, role } of await deps.plans.findOwnedBy(identityId)) {
    if (role !== "host" || (plan.visibility !== "followers" && plan.federatedAt === undefined)) {
      continue;
    }
    const linkOnly = plan.visibility === "followers";
    await deps.plans.update({
      ...plan,
      visibility: linkOnly ? "link" : plan.visibility,
      federatedAt: undefined,
      updatedAt: now,
    });
    if (linkOnly) changed++;
  }
  // Told while its keys still exist; retiring forgets them (D38), together with any follow
  // accepted after this list was made, which then learns from the gone actor itself.
  const profile = await actors.profiles.findActive(identityId);
  const followers = profile === undefined ? [] : await actors.followers.list(profile.id);
  if (profile !== undefined && followers.length > 0) {
    await actors.publisher?.deleteActor(profile.id, followers);
  }
  await actors.profiles.retire(identityId, now);
  return changed;
}

/** The account's handle while its profile is active, for its export and its deletion page. */
export async function activeHandle(
  deps: Pick<PlanDeps, "posterActors">,
  identityId: string,
): Promise<string | undefined> {
  return (await deps.posterActors?.profiles.findActive(identityId))?.handle;
}

type ActorDeps = Pick<PlanDeps, "posterActors" | "plans" | "clock"> & {
  identities: Pick<IdentityRepository, "findById">;
};

export type PosterActor =
  | {
      kind: "active";
      id: string;
      handle: string;
      displayName: string | undefined;
      /** The stored signing keys, for the federation adapter to read. */
      keys: string;
    }
  /** Turned off for good (decision D37): answered as gone. */
  | { kind: "retired"; retiredAt: Date };

/** A poster actor by its identifier, while federation is on. */
export async function posterActor(deps: ActorDeps, id: string): Promise<PosterActor | undefined> {
  const actors = deps.posterActors;
  if (actors?.enabled !== true) return undefined;
  const found = await actors.profiles.findActor(id);
  if (found === undefined) return undefined;
  if (found.kind === "retired") return found;
  const identity = await deps.identities.findById(found.profile.identityId);
  return {
    kind: "active",
    id: found.profile.id,
    handle: found.profile.handle,
    displayName: identity?.displayName,
    keys: found.keys,
  };
}

/** A poster actor's stored signing keys, without the rest of the actor, while it is active. */
export async function posterActorKeys(
  deps: Pick<PlanDeps, "posterActors">,
  id: string,
): Promise<string | undefined> {
  const actors = deps.posterActors;
  if (actors?.enabled !== true) return undefined;
  const found = await actors.profiles.findActor(id);
  return found?.kind === "active" ? found.keys : undefined;
}

/**
 * The actor identifier for a handle, while it is active and federation is on. In any case, as
 * WebFinger may ask for @Anna: handles are lowercase.
 */
export async function posterActorFor(deps: ActorDeps, handle: string): Promise<string | undefined> {
  const actors = deps.posterActors;
  if (actors?.enabled !== true) return undefined;
  return (await actors.profiles.findByHandle(handle.toLowerCase()))?.id;
}

/**
 * Who a plan is attributed to in the fediverse: its owner's actor once the plan was saved under
 * the fediverse wording and while the profile is active (D35, D37); otherwise none, and the
 * federation adapter names the instance actor.
 */
export async function planActor(
  deps: ActorDeps,
  plan: { id: string; federatedAt: Date | undefined },
): Promise<string | undefined> {
  const actors = deps.posterActors;
  if (actors?.enabled !== true || plan.federatedAt === undefined) return undefined;
  const owner = await deps.plans.ownerOf(plan.id);
  return owner === undefined ? undefined : (await actors.profiles.findActive(owner))?.id;
}

export interface ProfilePlan {
  planId: string;
  title: string;
  activity: ActivityType;
  startsAt: Date;
  timeZone: string;
  areaLabel: string;
}

/**
 * The profile page (decision D36): the display name and the owner's upcoming public plans, never
 * followers or link-only ones; a retired profile only says it is gone.
 */
export async function viewProfilePage(
  deps: ActorDeps,
  handle: string,
): Promise<
  | { kind: "not_found" }
  | { kind: "found"; handle: string; displayName: string | undefined; plans: ProfilePlan[] }
> {
  const actors = deps.posterActors;
  if (actors?.enabled !== true) return { kind: "not_found" };
  const profile = await actors.profiles.findByHandle(handle);
  if (profile === undefined) return { kind: "not_found" };
  const identity = await deps.identities.findById(profile.identityId);
  const now = deps.clock.now();
  const plans = (await deps.plans.findOwnedBy(profile.identityId))
    .filter(
      ({ plan, role }) =>
        role === "host" &&
        plan.visibility === "public" &&
        plan.status === "active" &&
        plan.startsAt > now,
    )
    .map(({ plan }) => ({
      planId: plan.id,
      title: plan.title,
      activity: plan.activity,
      startsAt: plan.startsAt,
      timeZone: plan.timeZone,
      areaLabel: plan.area.label,
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { kind: "found", handle: profile.handle, displayName: identity?.displayName, plans };
}
