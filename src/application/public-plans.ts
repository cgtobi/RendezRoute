// Who can find a plan (spec 3.3, 7; decisions D35, D36, D37), decided by the plan's owner, not the
// device that edits it: a co-host with the host link may make an account's plan public.
// - Public: with PUBLIC_REQUIRES_LOGIN (the default) only plans that belong to an account; only
//   where something finds it: Nearby, or the owner's profile sharing it (I59, D37). A plan or
//   template already public stays so (I58).
// - Followers: only while federation is on, for an owner with an active fediverse profile (D37). A
//   plan or template already for followers stays so, even with federation turned off (I58).
// - Shared in the fediverse: public and followers plans of an owner with a profile, from when they
//   are saved under that wording (D35); public plans of others are listed in Nearby only.
import type { FieldError } from "../domain/plan-input.ts";
import { mayBePublic, type Plan, type Visibility } from "../domain/plan.ts";
import type { PlanTemplate } from "../domain/template.ts";
import { type DeviceDeps, lookupDevice } from "./devices.ts";
import type { PlanDeps } from "./plans.ts";

type VisibilityDeps = Pick<
  PlanDeps,
  "publicRequiresLogin" | "publicPlansOffered" | "plans" | "posterActors"
> &
  DeviceDeps;

/**
 * The plan in question: a new one this device makes (it belongs to the device's account, if
 * logged in), a stored plan (its owner decides), or a template this device repeats.
 */
export type PlanFor =
  | { deviceToken: string | undefined }
  | { plan: Pick<Plan, "id" | "visibility"> }
  | { template: Pick<PlanTemplate, "visibility">; deviceToken: string | undefined };

export interface VisibilityChoices {
  publicAllowed: boolean;
  /** For `{ plan }`: whether the plan's owner is an account; for create and repeat: whether this device has one. */
  hasAccount: boolean;
  /** Undefined while federation is off and the plan is not for followers: not offered at all. */
  followers: { allowed: boolean } | undefined;
  /** The owner's handle while it has an active profile: it shares public and followers plans. */
  sharedBy: string | undefined;
  /**
   * A stored plan in the fediverse now, or withdrawn from it for good (D39): narrowing a shared
   * plan withdraws it, and a withdrawn one is not shared again.
   */
  fediverse?: "shared" | "withdrawn" | undefined;
}

/** What the forms offer for the plan in question, and who would share it in the fediverse. */
export async function visibilityChoices(
  deps: VisibilityDeps,
  about: PlanFor,
): Promise<VisibilityChoices> {
  const stored = "plan" in about ? about.plan : "template" in about ? about.template : undefined;
  const owner =
    "plan" in about
      ? await deps.plans.ownerOf(about.plan.id)
      : (await lookupDevice(deps, about.deviceToken))?.identityId;
  const actors = deps.posterActors?.enabled === true ? deps.posterActors : undefined;
  const profile =
    actors === undefined || owner === undefined
      ? undefined
      : await actors.profiles.findActive(owner);
  const state =
    "plan" in about && actors !== undefined
      ? (await actors.publications.find(about.plan.id)).kind
      : undefined;
  const withdrawn = state === "withdrawn";
  // Listed in Nearby, or shared by the owner's profile: otherwise nothing would find it.
  const found = deps.publicPlansOffered !== false || (profile !== undefined && !withdrawn);
  return {
    hasAccount: owner !== undefined,
    publicAllowed:
      stored?.visibility === "public" ||
      (found &&
        mayBePublic(
          { requiresLogin: deps.publicRequiresLogin ?? true },
          { ownerIdentityId: owner, visibility: stored?.visibility },
        )),
    followers:
      actors === undefined && stored?.visibility !== "followers"
        ? undefined
        : { allowed: profile !== undefined || stored?.visibility === "followers" },
    // A withdrawn plan is not shared again (D39), so the options do not say it would be.
    sharedBy: withdrawn ? undefined : profile?.handle,
    fediverse: state === "published" ? "shared" : withdrawn ? "withdrawn" : undefined,
  };
}

/** The form error when a visibility was chosen where it may not be; undefined otherwise. */
export function visibilityRefused(
  chosen: Visibility,
  choices: VisibilityChoices,
): FieldError[] | undefined {
  if (chosen === "public" && !choices.publicAllowed) {
    return [{ field: "visibility", code: "public_needs_login" }];
  }
  if (chosen === "followers" && choices.followers?.allowed !== true) {
    return [{ field: "visibility", code: "followers_needs_profile" }];
  }
  return undefined;
}

/**
 * When the plan counts as saved under the fediverse wording (D35): kept from an earlier save
 * (retiring a profile clears it on all the owner's plans, D37), set now for a public or followers
 * plan of an owner with a profile, cleared for link-only.
 */
export function federatedAtFor(
  chosen: Visibility,
  choices: VisibilityChoices,
  previous: Date | undefined,
  now: Date,
): Date | undefined {
  if (chosen === "link") return undefined;
  return previous ?? (choices.sharedBy === undefined ? undefined : now);
}
