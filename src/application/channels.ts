// "Notify me about this plan" (spec 6 feature 3, decision D17): one switch per response for the
// person who responded, one per hosted plan for the host. Each browser subscribes on its own.
import { MAX_CHANNELS_PER_OWNER, parsePushSubscription } from "../domain/push.ts";
import { isBlocked } from "../domain/response.ts";
import { lookupDevice, resolveDevice } from "./devices.ts";
import { asHost, type Denied, isDenied } from "./host.ts";
import type { PlanDeps } from "./plans.ts";
import type { ChannelOwner } from "./ports.ts";

/** Whose switch a request is about: the device's own response, or the plan it hosts. */
export interface SwitchRequest {
  planId: string;
  deviceToken: string | undefined;
  role: "responder" | "host";
}

/**
 * The channel owner this device may manage. Rejected and removed people get their one notice and
 * nothing after (spec 3.5): they cannot turn notifications on, but can still turn them off.
 */
export async function ownerFor(
  deps: PlanDeps,
  request: SwitchRequest,
  purpose: "subscribe" | "manage",
): Promise<ChannelOwner | Denied> {
  if (request.role === "host") {
    const plan = await asHost(deps, request.planId, request.deviceToken);
    return isDenied(plan) ? plan : { planId: plan.id };
  }
  const device = await resolveDevice(deps, request.deviceToken);
  const plan = await deps.plans.findById(request.planId);
  if (device === undefined || plan === undefined) return { kind: "not_found" };
  const response = await deps.responses.findForDevice(plan.id, device.id);
  if (response === undefined) return { kind: "not_found" };
  const blocked = isBlocked(response.kind);
  if (blocked && purpose === "subscribe") return { kind: "forbidden" };
  return { responseId: response.id };
}

const denied = (owner: ChannelOwner | Denied): owner is Denied => "kind" in owner;

function channelsOf(deps: PlanDeps) {
  if (deps.notify === undefined) throw new Error("Notifications are not configured.");
  return deps.notify.channels;
}

export async function subscribe(
  deps: PlanDeps,
  request: SwitchRequest & { subscription: unknown },
): Promise<Denied | { kind: "subscribed" } | { kind: "invalid" }> {
  const owner = await ownerFor(deps, request, "subscribe");
  if (denied(owner)) return owner;
  const subscription = parsePushSubscription(request.subscription);
  if (!subscription.ok) return { kind: "invalid" };
  const device = await lookupDevice(deps, request.deviceToken);
  if (device === undefined) return { kind: "not_found" };
  const channels = channelsOf(deps);
  await channels.add(owner, subscription.value, device.id);
  // Browsers only: an email address is not one of the five (decision D31).
  const all = (await channels.listFor(owner)).filter((channel) => channel.kind === "webpush");
  for (const oldest of all.slice(0, Math.max(0, all.length - MAX_CHANNELS_PER_OWNER))) {
    await channels.delete(oldest.id);
  }
  return { kind: "subscribed" };
}

export async function unsubscribe(
  deps: PlanDeps,
  request: SwitchRequest & { endpoint: string },
): Promise<Denied | { kind: "unsubscribed" }> {
  const owner = await ownerFor(deps, request, "manage");
  if (denied(owner)) return owner;
  await channelsOf(deps).remove(owner, request.endpoint);
  return { kind: "unsubscribed" };
}

export async function notificationStatus(
  deps: PlanDeps,
  request: SwitchRequest & { endpoint: string },
): Promise<Denied | { kind: "status"; enabled: boolean }> {
  const owner = await ownerFor(deps, request, "manage");
  if (denied(owner)) return owner;
  return { kind: "status", enabled: await channelsOf(deps).has(owner, request.endpoint) };
}
