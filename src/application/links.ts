// "Get a new link", "Email me my links" and "Sign out all other devices" for host, manage and
// template links (spec 3.2, 7; decisions I44, D31). Only a device linked to the item may use them.
import { resolveDevice } from "./devices.ts";
import { type Denied, isDenied } from "./host.ts";
import { CREATION_NONCE, type PlanDeps } from "./plans.ts";
import { confirmedRecipient } from "./channel-links.ts";
import type { ChannelOwner, DeviceLinkTarget, EmailRecipient } from "./ports.ts";

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
  /** The account the device is logged in to: a template's emails go to its address. */
  identityId: string | undefined;
  /** The plan's or template's title, for the email with the new link. */
  title: string;
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
  return { deviceId: device.id, identityId: device.identityId, title: found.title, ...item };
}

/** What a device would be linked to for this kind of link, if anything. */
async function itemFor(
  deps: PlanDeps,
  { kind, id }: LinkRequest,
  deviceId: string,
): Promise<Omit<LinkedItem, "deviceId" | "identityId" | "title"> | undefined> {
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
 * Where "Email me my links" sends the item's new link (decision D31): the confirmed address of the
 * plan or response, and for a template, which has none, the confirmed address of the account the
 * device is logged in to. Undefined without SMTP.
 */
async function newLinkRecipient(
  deps: PlanDeps,
  item: LinkedItem,
): Promise<EmailRecipient | undefined> {
  const notify = deps.notify;
  if (notify?.email?.outbox === undefined) return undefined;
  const owner =
    item.channels ?? (item.identityId === undefined ? undefined : { identityId: item.identityId });
  if (owner === undefined) return undefined;
  return confirmedRecipient(deps, await notify.channels.emailFor(owner));
}

/** The address "Email me my links" would use, for the button's hint; undefined: no button. */
export async function newLinkAddress(
  deps: PlanDeps,
  request: LinkRequest,
): Promise<string | undefined> {
  const item = await linkedItem(deps, request);
  if (isDenied(item)) return undefined;
  return (await newLinkRecipient(deps, item))?.address;
}

/**
 * "Email me my links": a new link, sent to the item's confirmed address. Sent while the request
 * waits, never queued, so the secret is stored nowhere; the old link stops working only once the
 * email went out, and nothing changes when it could not be sent (decision D31).
 */
export async function emailNewLink(
  deps: PlanDeps,
  request: LinkRequest & { formNonce: string; linkUrl: (token: string) => string },
): Promise<
  | { kind: "sent"; address: string }
  | { kind: "already_issued" }
  | { kind: "not_sent" }
  | { kind: "no_address" }
  | { kind: "bad_request" }
  | Denied
> {
  const item = await linkedItem(deps, request);
  if (isDenied(item)) return item;
  if (!CREATION_NONCE.test(request.formNonce)) return { kind: "bad_request" };
  const outbox = deps.notify?.email?.outbox;
  const to = await newLinkRecipient(deps, item);
  if (outbox === undefined || to === undefined) return { kind: "no_address" };
  if (!(await deps.formNonces.claim(request.formNonce, deps.clock.now()))) {
    return { kind: "already_issued" };
  }
  const token = deps.tokens.generate();
  const result = await outbox.newLink(to, { title: item.title, url: request.linkUrl(token) });
  if (result !== "sent") return { kind: "not_sent" };
  await item.saveHash(deps.tokens.hash(token));
  return { kind: "sent", address: to.address };
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
