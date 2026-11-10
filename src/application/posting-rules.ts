// Who may create plans (spec 7 Moderation). Kept apart from the invite use cases so plan creation
// needs no runtime import of them: only types come from plans.ts.
import { postingRequirement } from "../domain/invite.ts";
import { lookupDevice } from "./devices.ts";
import type { PlanDeps } from "./plans.ts";

type PostingDeps = Pick<
  PlanDeps,
  "postingMode" | "permissions" | "devices" | "tokens" | "ids" | "clock"
>;

/** Whether an invite link let the device, or the account logged in on it, post. Never writes. */
export async function deviceMayPost(
  deps: Pick<PlanDeps, "permissions" | "devices" | "tokens" | "ids" | "clock">,
  deviceToken: string | undefined,
): Promise<boolean> {
  const device = await lookupDevice(deps, deviceToken);
  return device !== undefined && (await deps.permissions.mayPostSince(device.id)) !== undefined;
}

/** What keeps a device from creating plans: an invite link or a login it lacks. */
export type PostingNeed = "invite" | "login";

/** What the device still needs before it may create plans, if anything. Never writes. */
export async function postingNeed(
  deps: PostingDeps,
  request: { deviceToken: string | undefined },
): Promise<PostingNeed | undefined> {
  switch (postingRequirement(deps.postingMode)) {
    case "none":
      return undefined;
    case "invite":
      return (await deviceMayPost(deps, request.deviceToken)) ? undefined : "invite";
    case "login":
      return (await lookupDevice(deps, request.deviceToken))?.identityId === undefined
        ? "login"
        : undefined;
  }
}

/** Whether the device may create plans under the instance's posting rules. Never writes. */
export async function mayCreatePlans(
  deps: PostingDeps,
  request: { deviceToken: string | undefined },
): Promise<boolean> {
  return (await postingNeed(deps, request)) === undefined;
}
