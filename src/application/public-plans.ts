// Who may make a plan public (spec 3.3, 7 Visibility and Nearby plans; decision D35): with
// PUBLIC_REQUIRES_LOGIN (the default) only plans that belong to an account, so the instance does
// not list, and later publish to the fediverse, plans nobody can be held to. The plan's owner
// decides, not the device that edits it: a co-host with the host link may make an account's plan
// public. A plan or template already public stays so when the rule is turned on later; Repeat
// then checks again for the new plan (decision I58).
import type { FieldError } from "../domain/plan-input.ts";
import { mayBePublic, type Plan, type Visibility } from "../domain/plan.ts";
import type { PlanTemplate } from "../domain/template.ts";
import { type DeviceDeps, lookupDevice } from "./devices.ts";
import type { PlanDeps } from "./plans.ts";

type PublicDeps = Pick<PlanDeps, "publicRequiresLogin" | "publicPlansOffered" | "plans"> &
  DeviceDeps;

/**
 * The plan in question: a new one this device makes (it belongs to the device's account, if
 * logged in), a stored plan (its owner decides), or a template this device repeats.
 */
export type PublicFor =
  | { deviceToken: string | undefined }
  | { plan: Pick<Plan, "id" | "visibility"> }
  | { template: Pick<PlanTemplate, "visibility">; deviceToken: string | undefined };

/** Whether the plan in question may be public. */
export async function publicAllowedFor(deps: PublicDeps, about: PublicFor): Promise<boolean> {
  if (deps.publicPlansOffered === false) {
    // Not offered: only what is public already stays so.
    const stored = "plan" in about ? about.plan : "template" in about ? about.template : undefined;
    return stored?.visibility === "public";
  }
  const rule = { requiresLogin: deps.publicRequiresLogin ?? true };
  // Without the rule, nothing needs looking up.
  if (!rule.requiresLogin) return true;
  if ("plan" in about) {
    return mayBePublic(rule, {
      ownerIdentityId: await deps.plans.ownerOf(about.plan.id),
      visibility: about.plan.visibility,
    });
  }
  const device = await lookupDevice(deps, about.deviceToken);
  return mayBePublic(rule, {
    ownerIdentityId: device?.identityId,
    visibility: "template" in about ? about.template.visibility : undefined,
  });
}

/** The form error when public was chosen where it may not be; undefined otherwise. */
export async function publicRefused(
  deps: PublicDeps,
  chosen: Visibility,
  about: PublicFor,
): Promise<FieldError[] | undefined> {
  return chosen === "public" && !(await publicAllowedFor(deps, about))
    ? [{ field: "visibility", code: "public_needs_login" }]
    : undefined;
}
