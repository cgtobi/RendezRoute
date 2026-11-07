// Secret links (spec 3.2, decision D1): host links for posters, manage links for people
// who responded. Opening a link never changes state; only a confirmation (POST) links
// the device.
import type { DeviceLinkTarget } from "./ports.ts";
import { ensureDevice, lookupDevice } from "./devices.ts";
import type { PlanDeps } from "./plans.ts";

export type OpenSecretLinkResult =
  | { kind: "not_found" }
  | { kind: "already_linked"; planId: string }
  | { kind: "confirm"; planId: string; title: string };

export type ConfirmSecretLinkResult =
  | { kind: "not_found" }
  | { kind: "linked"; planId: string; newDeviceToken: string | undefined };

type Role = DeviceLinkTarget["role"];

/** The plan a token belongs to, and what a device gets linked to. */
async function resolveToken(
  deps: PlanDeps,
  role: Role,
  token: string,
): Promise<{ planId: string; title: string; target: DeviceLinkTarget } | undefined> {
  const hash = deps.tokens.hash(token);
  if (role === "host") {
    const plan = await deps.plans.findByHostTokenHash(hash);
    return plan === undefined
      ? undefined
      : { planId: plan.id, title: plan.title, target: { role, planId: plan.id } };
  }
  const response = await deps.responses.findByManageTokenHash(hash);
  if (response === undefined) return undefined;
  const plan = await deps.plans.findById(response.planId);
  return plan === undefined
    ? undefined
    : { planId: plan.id, title: plan.title, target: { role, responseId: response.id } };
}

async function openSecretLink(
  deps: PlanDeps,
  role: Role,
  request: { token: string; deviceToken: string | undefined },
): Promise<OpenSecretLinkResult> {
  const resolved = await resolveToken(deps, role, request.token);
  if (resolved === undefined) return { kind: "not_found" };
  // Decision D1: opening a link must not change state, so no activity update here.
  const device = await lookupDevice(deps, request.deviceToken);
  if (device !== undefined && (await deps.devices.hasLink(device.id, resolved.target))) {
    return { kind: "already_linked", planId: resolved.planId };
  }
  return { kind: "confirm", planId: resolved.planId, title: resolved.title };
}

async function confirmSecretLink(
  deps: PlanDeps,
  role: Role,
  request: { token: string; deviceToken: string | undefined },
): Promise<ConfirmSecretLinkResult> {
  const resolved = await resolveToken(deps, role, request.token);
  if (resolved === undefined) return { kind: "not_found" };
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  await deps.devices.link(device.id, resolved.target, deps.clock.now());
  return { kind: "linked", planId: resolved.planId, newDeviceToken: newToken };
}

type Request = { token: string; deviceToken: string | undefined };

export const openHostLink = (deps: PlanDeps, request: Request) =>
  openSecretLink(deps, "host", request);
export const confirmHostLink = (deps: PlanDeps, request: Request) =>
  confirmSecretLink(deps, "host", request);
export const openManageLink = (deps: PlanDeps, request: Request) =>
  openSecretLink(deps, "manage", request);
export const confirmManageLink = (deps: PlanDeps, request: Request) =>
  confirmSecretLink(deps, "manage", request);
