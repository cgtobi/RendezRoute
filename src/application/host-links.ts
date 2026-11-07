// Host (secret) links (spec 3.2, decision D1): opening a link never changes state;
// only an explicit confirmation (POST) links the device.
import { ensureDevice, lookupDevice } from "./devices.ts";
import type { PlanDeps } from "./plans.ts";

export type OpenHostLinkResult =
  | { kind: "not_found" }
  | { kind: "already_linked"; planId: string }
  | { kind: "confirm"; planId: string; title: string };

export async function openHostLink(
  deps: PlanDeps,
  request: { token: string; deviceToken: string | undefined },
): Promise<OpenHostLinkResult> {
  const plan = await deps.plans.findByHostTokenHash(deps.tokens.hash(request.token));
  if (plan === undefined) return { kind: "not_found" };
  // Decision D1: opening a link must not change state, so no activity update here.
  const device = await lookupDevice(deps, request.deviceToken);
  if (device !== undefined && (await deps.devices.isHost(device.id, plan.id))) {
    return { kind: "already_linked", planId: plan.id };
  }
  return { kind: "confirm", planId: plan.id, title: plan.title };
}

export type ConfirmHostLinkResult =
  | { kind: "not_found" }
  | { kind: "linked"; planId: string; newDeviceToken: string | undefined };

export async function confirmHostLink(
  deps: PlanDeps,
  request: { token: string; deviceToken: string | undefined },
): Promise<ConfirmHostLinkResult> {
  const plan = await deps.plans.findByHostTokenHash(deps.tokens.hash(request.token));
  if (plan === undefined) return { kind: "not_found" };
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  await deps.devices.linkHost(device.id, plan.id, deps.clock.now());
  return { kind: "linked", planId: plan.id, newDeviceToken: newToken };
}
