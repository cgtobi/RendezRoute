// ntfy (spec 7 Optional notification channels, decision D33): one topic per response, hosted plan
// or account, made by the app on the instance's server, random and unguessable. People subscribe
// to it in the ntfy app; nothing but the confirmation link is posted to it until that link is used
// (channel-links.ts). Without NTFY_URL (also when it is removed later), stored topics can still be
// turned off.
import { ownerFor, type SwitchRequest } from "./channels.ts";
import { canReach } from "./channel-kinds.ts";
import { accountOf, queueConfirmation } from "./channel-links.ts";
import { type Denied, isDenied } from "./host.ts";
import type { PlanDeps } from "./plans.ts";
import type { ChannelOwner } from "./ports.ts";

type Unavailable = { kind: "unavailable" };
const UNAVAILABLE: Unavailable = { kind: "unavailable" };

export type NtfySetting =
  | { kind: "setting"; state: "off"; server: URL }
  | {
      kind: "setting";
      state: "pending" | "on";
      /** Where to subscribe; undefined once NTFY_URL is removed (only turning off is left). */
      server: URL | undefined;
      topic: string;
    };

async function settingFor(deps: PlanDeps, owner: ChannelOwner): Promise<NtfySetting | Unavailable> {
  const notify = deps.notify;
  const channel = await notify?.channels.ntfyFor(owner);
  const server = notify?.ntfy?.server;
  if (channel === undefined) {
    return server === undefined ? UNAVAILABLE : { kind: "setting", state: "off", server };
  }
  return {
    kind: "setting",
    state: channel.verified ? "on" : "pending",
    // A topic on a server no longer configured gets nothing: only turning it off is left.
    server: canReach(notify, channel) ? server : undefined,
    topic: channel.topic,
  };
}

/** What the manage or host page shows: no topic, one waiting for confirmation, or one in use. */
export async function ntfySetting(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<NtfySetting | Unavailable | Denied> {
  const owner = await ownerFor(deps, request, "manage");
  return isDenied(owner) ? owner : settingFor(deps, owner);
}

export async function accountNtfySetting(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<NtfySetting | Unavailable> {
  const account = await accountOf(deps, request.deviceToken);
  return account === undefined ? UNAVAILABLE : settingFor(deps, account);
}

type RequestResult = { kind: "sent" } | { kind: "unchanged" } | Unavailable;

/**
 * Makes the owner's topic and posts the confirmation link to it; while it waits, posts the link
 * again (ntfy keeps messages for a while, so subscribing afterwards still shows it). Once
 * confirmed, nothing changes.
 */
async function requestFor(
  deps: PlanDeps,
  owner: ChannelOwner,
  language: string | undefined,
): Promise<RequestResult> {
  const notify = deps.notify;
  if (notify?.ntfy === undefined) return UNAVAILABLE;
  const found = await notify.channels.ntfyFor(owner);
  // A topic on another server is of no use any more: a new one replaces it.
  const existing = found !== undefined && canReach(notify, found) ? found : undefined;
  if (existing?.verified === true) return { kind: "unchanged" };
  const channelId =
    existing?.id ??
    (await notify.channels.setNtfy(
      owner,
      { topic: deps.tokens.generate(), server: notify.ntfy.server.href },
      language,
    ));
  await queueConfirmation(deps, owner, channelId);
  return { kind: "sent" };
}

/** Rejected and removed people may only turn ntfy off (spec 3.5). */
export async function requestNtfy(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<RequestResult | Denied> {
  const owner = await ownerFor(deps, request, "subscribe");
  return isDenied(owner) ? owner : requestFor(deps, owner, undefined);
}

/** The account's topic keeps the page's language, which later notices use. */
export async function requestAccountNtfy(
  deps: PlanDeps,
  request: { deviceToken: string | undefined; language: string },
): Promise<RequestResult> {
  const account = await accountOf(deps, request.deviceToken);
  return account === undefined ? UNAVAILABLE : requestFor(deps, account, request.language);
}

async function turnOffFor(deps: PlanDeps, owner: ChannelOwner): Promise<{ kind: "off" }> {
  const channel = await deps.notify?.channels.ntfyFor(owner);
  if (channel !== undefined) await deps.notify?.channels.delete(channel.id);
  return { kind: "off" };
}

export async function turnOffNtfy(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<{ kind: "off" } | Denied> {
  const owner = await ownerFor(deps, request, "manage");
  return isDenied(owner) ? owner : turnOffFor(deps, owner);
}

export async function turnOffAccountNtfy(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "off" } | Unavailable> {
  const account = await accountOf(deps, request.deviceToken);
  return account === undefined ? UNAVAILABLE : turnOffFor(deps, account);
}
