// "Get a new link" and "Sign out all other devices" for host, manage and template links (spec 3.2,
// decision I44). Only a device linked to the item may do either.
import { resolveDevice } from "./devices.ts";
import { type Denied, isDenied } from "./host.ts";
import { CREATION_NONCE, type PlanDeps } from "./plans.ts";
import type { ChannelOwner, DeviceLinkTarget } from "./ports.ts";

/** Whose link: the host's or the device's own response to a plan, or a template. */
export type LinkKind = "host" | "manage" | "template";

type LinkRequest = {
  kind: LinkKind;
  /** The plan's ID for host and manage links, the template's for template links. */
  id: string;
  deviceToken: string | undefined;
};

interface LinkedItem {
  deviceId: string;
  target: DeviceLinkTarget;
  /** Notifications for the item; templates have none. */
  channels: ChannelOwner | undefined;
  /** Replaces the stored hash of the item's link. */
  saveHash: (hash: string) => Promise<void>;
}

/** The item behind the link, if the requesting device is linked to it. */
async function linkedItem(deps: PlanDeps, request: LinkRequest): Promise<LinkedItem | Denied> {
  const found =
    request.kind === "template"
      ? await deps.templates.findById(request.id)
      : await deps.plans.findById(request.id);
  if (found === undefined) return { kind: "not_found" };
  const device = await resolveDevice(deps, request.deviceToken);
  if (device === undefined) return { kind: "forbidden" };
  const item = await itemFor(deps, request, device.id);
  if (item === undefined || !(await deps.devices.hasLink(device.id, item.target))) {
    return { kind: "forbidden" };
  }
  return { deviceId: device.id, ...item };
}

/** What a device would be linked to for this kind of link, if anything. */
async function itemFor(
  deps: PlanDeps,
  { kind, id }: LinkRequest,
  deviceId: string,
): Promise<Omit<LinkedItem, "deviceId"> | undefined> {
  switch (kind) {
    case "host":
      return {
        target: { role: "host", planId: id },
        channels: { planId: id },
        saveHash: (hash) => deps.plans.setHostTokenHash(id, hash),
      };
    case "template":
      return {
        target: { role: "template", templateId: id },
        channels: undefined,
        saveHash: (hash) => deps.templates.setHostTokenHash(id, hash),
      };
    case "manage": {
      // A device manages at most one response per plan (spec 3.2); removed and rejected people
      // may also replace theirs.
      const response = await deps.responses.findForDevice(id, deviceId);
      return response === undefined
        ? undefined
        : {
            target: { role: "manage", responseId: response.id },
            channels: { responseId: response.id },
            saveHash: (hash) => deps.responses.setManageTokenHash(response.id, hash),
          };
    }
  }
}

/**
 * "Get a new link": the old link stops working, linked devices keep access, and the new link is
 * shown once (spec 3.2). Also how templates kept at deletion get a link (decision I36). A form sent
 * again (reload, back button) issues nothing, so the link just shown keeps working.
 */
export async function getNewLink(
  deps: PlanDeps,
  request: LinkRequest & { formNonce: string },
): Promise<
  { kind: "issued"; token: string } | { kind: "already_issued" } | { kind: "bad_request" } | Denied
> {
  const item = await linkedItem(deps, request);
  if (isDenied(item)) return item;
  if (!CREATION_NONCE.test(request.formNonce)) return { kind: "bad_request" };
  if (!(await deps.formNonces.claim(request.formNonce, deps.clock.now()))) {
    return { kind: "already_issued" };
  }
  const token = deps.tokens.generate();
  await item.saveHash(deps.tokens.hash(token));
  return { kind: "issued", token };
}

/**
 * "Sign out all other devices": only the current device stays linked (spec 3.2). Notification
 * subscriptions of the item are removed too, since they cannot be told apart by device; the
 * current device can turn them on again (user decision 2026-11-09). They go first, so a failure
 * in between never leaves a leaked device subscribed.
 */
export async function signOutOtherDevices(
  deps: PlanDeps,
  request: LinkRequest,
): Promise<{ kind: "signed_out"; devices: number } | Denied> {
  const item = await linkedItem(deps, request);
  if (isDenied(item)) return item;
  if (item.channels !== undefined && deps.notify !== undefined) {
    for (const channel of await deps.notify.channels.listFor(item.channels)) {
      await deps.notify.channels.delete(channel.id);
    }
  }
  const devices = await deps.devices.unlinkOthers(item.target, item.deviceId);
  return { kind: "signed_out", devices };
}
