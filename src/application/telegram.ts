// Telegram (spec 7 Optional notification channels, decision D34): one chat per response, hosted
// plan or account. The page offers a deep link into the instance's bot with a one-time code;
// pressing Start there links the person's own chat and confirms it, and the bot answers that
// notifications are on. Nothing is sent before. Every message has a button to turn them off;
// blocking the bot ends them too. Rejected and removed people may only turn Telegram off (3.5).
import { ownerFor, type SwitchRequest } from "./channels.ts";
import { canReach } from "./channel-kinds.ts";
import { aboutChannel, accountOf, confirmedRecipient, sendVia } from "./channel-links.ts";
import { type Denied, isDenied } from "./host.ts";
import type { PlanDeps } from "./plans.ts";
import type { ChannelOwner } from "./ports.ts";

type Unavailable = { kind: "unavailable" };
const UNAVAILABLE: Unavailable = { kind: "unavailable" };

export type TelegramSetting =
  | { kind: "setting"; state: "off" }
  /**
   * Waiting for Start: the bot's name and the one-time code for the deep link, or none while
   * Telegram has not told the bot's name or the bot is gone from the configuration.
   */
  | {
      kind: "setting";
      state: "pending";
      start: { botName: string; startToken: string } | undefined;
    }
  /** `sending` false once the bot is gone from the configuration: only turning off is left. */
  | { kind: "setting"; state: "on"; sending: boolean };

/** The bot's name, while it is configured and Telegram told it. */
const botNameOf = (deps: PlanDeps) => deps.notify?.telegram?.botName();

async function settingFor(
  deps: PlanDeps,
  owner: ChannelOwner,
): Promise<TelegramSetting | Unavailable> {
  const notify = deps.notify;
  const channel = await notify?.channels.telegramFor(owner);
  const botName = botNameOf(deps);
  const links = notify?.links;
  if (channel?.verified === true) {
    return { kind: "setting", state: "on", sending: canReach(notify, channel) };
  }
  if (channel !== undefined) {
    const start =
      botName === undefined || links === undefined
        ? undefined
        : { botName, startToken: links.startTokenFor(channel.id) };
    return { kind: "setting", state: "pending", start };
  }
  return botName === undefined || links === undefined
    ? UNAVAILABLE
    : { kind: "setting", state: "off" };
}

/** What the manage or host page shows: nothing yet, waiting for Start, or on. */
export async function telegramSetting(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<TelegramSetting | Unavailable | Denied> {
  const owner = await ownerFor(deps, request, "manage");
  return isDenied(owner) ? owner : settingFor(deps, owner);
}

export async function accountTelegramSetting(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<TelegramSetting | Unavailable> {
  const account = await accountOf(deps, request.deviceToken);
  return account === undefined ? UNAVAILABLE : settingFor(deps, account);
}

type RequestResult = { kind: "ready" } | { kind: "unchanged" } | Unavailable;

/** Makes the channel that waits for Start; one waiting or on stays as it is. */
async function requestFor(
  deps: PlanDeps,
  owner: ChannelOwner,
  language: string | undefined,
): Promise<RequestResult> {
  const notify = deps.notify;
  if (notify === undefined || botNameOf(deps) === undefined) return UNAVAILABLE;
  const existing = await notify.channels.telegramFor(owner);
  if (existing !== undefined) return { kind: "unchanged" };
  await notify.channels.setTelegram(owner, language);
  return { kind: "ready" };
}

/** Rejected and removed people may only turn Telegram off (spec 3.5). */
export async function requestTelegram(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<RequestResult | Denied> {
  const owner = await ownerFor(deps, request, "subscribe");
  return isDenied(owner) ? owner : requestFor(deps, owner, undefined);
}

/** The account's chat keeps the page's language, which later notices use. */
export async function requestAccountTelegram(
  deps: PlanDeps,
  request: { deviceToken: string | undefined; language: string },
): Promise<RequestResult> {
  const account = await accountOf(deps, request.deviceToken);
  return account === undefined ? UNAVAILABLE : requestFor(deps, account, request.language);
}

async function turnOffFor(deps: PlanDeps, owner: ChannelOwner): Promise<{ kind: "off" }> {
  const channel = await deps.notify?.channels.telegramFor(owner);
  if (channel !== undefined) await deps.notify?.channels.delete(channel.id);
  return { kind: "off" };
}

export async function turnOffTelegram(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<{ kind: "off" } | Denied> {
  const owner = await ownerFor(deps, request, "manage");
  return isDenied(owner) ? owner : turnOffFor(deps, owner);
}

export async function turnOffAccountTelegram(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "off" } | Unavailable> {
  const account = await accountOf(deps, request.deviceToken);
  return account === undefined ? UNAVAILABLE : turnOffFor(deps, account);
}

/** The linked chat's number for an export (spec 3.7): it identifies the person in Telegram. */
export async function exportedTelegramChat(
  deps: PlanDeps,
  owner: ChannelOwner,
): Promise<string | undefined> {
  return (await deps.notify?.channels.telegramFor(owner))?.chatId;
}

/**
 * Someone pressed Start with a code from a page (decision D34): their chat is linked to the
 * waiting channel, which is confirmed, and the bot says so. A made-up or used code, a chat for
 * someone rejected or removed since, or Start without a code changes nothing.
 */
export async function startTelegramChat(
  deps: PlanDeps,
  request: { startToken: string; chatId: string },
): Promise<{ kind: "confirmed" } | { kind: "ignored" }> {
  const notify = deps.notify;
  const channelId = notify?.links?.channelOfStart(request.startToken);
  if (notify?.telegram === undefined || channelId === undefined) return { kind: "ignored" };
  const channel = await notify.channels.findById(channelId);
  if (channel?.kind !== "telegram" || channel.verified) return { kind: "ignored" };
  const about = await aboutChannel(deps, channel);
  if (about === undefined || about.blocked) return { kind: "ignored" };
  if (!(await notify.channels.attachTelegramChat(channel.id, request.chatId))) {
    return { kind: "ignored" };
  }
  // The bot's answer; blocked already, the chat is deleted again, like for any message.
  const linked = await notify.channels.telegramFor(channel.owner);
  const to = await confirmedRecipient(deps, linked);
  if (linked !== undefined && to !== undefined) {
    await sendVia(notify, linked, to, (outbox, recipient) =>
      outbox.confirmation(recipient, about.subject),
    );
  }
  return { kind: "confirmed" };
}
