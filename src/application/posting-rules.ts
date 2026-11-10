// Who may create plans (spec 7 Moderation). Kept apart from the invite use cases so plan creation
// needs no runtime import of them: only types come from plans.ts.
import { postingRequirement } from "../domain/invite.ts";
import { lookupDevice } from "./devices.ts";
import type { PlanDeps } from "./plans.ts";

type PostingDeps = Pick<
  PlanDeps,
  "postingMode" | "permissions" | "devices" | "tokens" | "ids" | "clock"
>;

/** Whether an invite link let the device post. Never writes. */
export async function deviceMayPost(
  deps: Pick<PlanDeps, "permissions" | "devices" | "tokens" | "ids" | "clock">,
  deviceToken: string | undefined,
): Promise<boolean> {
  const device = await lookupDevice(deps, deviceToken);
  return device !== undefined && (await deps.permissions.mayPostSince(device.id)) !== undefined;
}

/** Whether the device may create plans under the instance's posting rules. Never writes. */
export async function mayCreatePlans(
  deps: PostingDeps,
  request: { deviceToken: string | undefined },
): Promise<boolean> {
  switch (postingRequirement(deps.postingMode)) {
    case "none":
      return true;
    case "invite":
      return deviceMayPost(deps, request.deviceToken);
  }
}
