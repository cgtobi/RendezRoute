// Channels confirmed through a link the app sends to them: email and ntfy (spec 7 Optional
// notification channels, decisions D31, D33). Their link confirms the channel, refuses it, and
// later turns it off; opening it changes nothing (decision D1). Here too: the confirmation job,
// and the account's notices such as the expiry warning (decision I52), sent through the outbox of
// each channel's kind. Rejected and removed people may only turn channels off (spec 3.5).
import { maskEmailAddress } from "../domain/email.ts";
import { accountDeleteAt } from "../domain/expiry.ts";
import { DEFAULT_NOTICE_LANGUAGE } from "../domain/notification.ts";
import { isBlocked } from "../domain/response.ts";
import { canReach } from "./channel-kinds.ts";
import { resolveDevice } from "./devices.ts";
import type { JobOutcome } from "./jobs.ts";
import { ownerIds } from "./notify.ts";
import type { PlanDeps } from "./plans.ts";
import type {
  ChannelOutbox,
  ChannelOwner,
  ChannelRecipient,
  ChannelSubject,
  ConfirmableChannel,
  IdentityRepository,
  SendResult,
} from "./ports.ts";

/** What the jobs and links read of the plan dependencies. */
type ChannelDeps = Pick<PlanDeps, "notify" | "plans" | "responses">;

/**
 * Sends one of the messages every confirmable channel gets through the outbox of its kind, when
 * the channel can be reached (channel-kinds.ts); "failed" otherwise. A recipient gone for good
 * (an address refused, the bot blocked) deletes the channel, as notifications do.
 */
export async function sendVia(
  notify: NonNullable<PlanDeps["notify"]>,
  channel: ConfirmableChannel,
  to: ChannelRecipient,
  message: <R extends ChannelRecipient>(outbox: ChannelOutbox<R>, to: R) => Promise<SendResult>,
): Promise<SendResult> {
  const result = await sendThrough(notify, channel, to, message);
  if (result === "gone") await notify.channels.delete(channel.id);
  return result;
}

function sendThrough(
  notify: NonNullable<PlanDeps["notify"]>,
  channel: ConfirmableChannel,
  to: ChannelRecipient,
  message: <R extends ChannelRecipient>(outbox: ChannelOutbox<R>, to: R) => Promise<SendResult>,
): Promise<SendResult> {
  if (canReach(notify, channel)) {
    if (to.kind === "email" && notify.email?.outbox !== undefined) {
      return message(notify.email.outbox, to);
    }
    if (to.kind === "ntfy" && notify.ntfy !== undefined) return message(notify.ntfy.outbox, to);
    if (to.kind === "telegram" && notify.telegram !== undefined) {
      return message(notify.telegram.outbox, to);
    }
  }
  return Promise.resolve("failed");
}

/** The account this device is logged in to, as a channel owner. */
export async function accountOf(
  deps: PlanDeps,
  deviceToken: string | undefined,
): Promise<{ identityId: string } | undefined> {
  const identityId = (await resolveDevice(deps, deviceToken))?.identityId;
  return identityId === undefined ? undefined : { identityId };
}

/** What a channel is for, in which language to write, and whether its owner is out. */
interface ChannelAbout {
  subject: ChannelSubject;
  language: string;
  /** Rejected or removed (spec 3.5): the channel can only be turned off. */
  blocked: boolean;
}

export async function aboutChannel(
  deps: Pick<PlanDeps, "plans" | "responses">,
  channel: ConfirmableChannel,
): Promise<ChannelAbout | undefined> {
  const { owner } = channel;
  if ("identityId" in owner) {
    // Goes with its account; written in the language it was set up in.
    return {
      subject: { kind: "account" },
      language: channel.language ?? DEFAULT_NOTICE_LANGUAGE,
      blocked: false,
    };
  }
  const response =
    "responseId" in owner ? await deps.responses.findById(owner.responseId) : undefined;
  const planId = "planId" in owner ? owner.planId : response?.planId;
  const plan = planId === undefined ? undefined : await deps.plans.findById(planId);
  if (plan === undefined) return undefined;
  return {
    subject: { kind: "plan", planTitle: plan.title },
    language: response?.language ?? plan.posterLanguage,
    blocked: response !== undefined && isBlocked(response.kind),
  };
}

/** Where the channel's outbox writes; a Telegram channel has nowhere until Start linked a chat. */
function recipientOf(channel: ConfirmableChannel, language: string): ChannelRecipient | undefined {
  switch (channel.kind) {
    case "email":
      return { kind: "email", channelId: channel.id, address: channel.address, language };
    case "ntfy":
      return { kind: "ntfy", channelId: channel.id, topic: channel.topic, language };
    case "telegram":
      return channel.chatId === undefined
        ? undefined
        : { kind: "telegram", channelId: channel.id, chatId: channel.chatId, language };
  }
}

/**
 * A confirmed channel as its outbox writes to it, in its owner's language; none for rejected and
 * removed people, who may only turn channels off (spec 3.5).
 */
export async function confirmedRecipient<C extends ConfirmableChannel>(
  deps: Pick<PlanDeps, "plans" | "responses">,
  channel: C | undefined,
): Promise<Extract<ChannelRecipient, { kind: C["kind"] }> | undefined> {
  if (channel === undefined || !channel.verified) return undefined;
  const about = await aboutChannel(deps, channel);
  return about === undefined || about.blocked
    ? undefined
    : (recipientOf(channel, about.language) as
        | Extract<ChannelRecipient, { kind: C["kind"] }>
        | undefined);
}

/** The channel behind a link, what it is about, and whether it may still be confirmed. */
async function linkTarget(
  deps: PlanDeps,
  token: string,
): Promise<{ channel: ConfirmableChannel; about: ChannelAbout; mayConfirm: boolean } | undefined> {
  const notify = deps.notify;
  const channelId = notify?.links?.channelOf(token);
  if (notify === undefined || channelId === undefined) return undefined;
  const channel = await notify.channels.findById(channelId);
  if (channel === undefined || channel.kind === "webpush") return undefined;
  const about = await aboutChannel(deps, channel);
  if (about === undefined) return undefined;
  // Telegram is confirmed by pressing Start in the bot, never through its link (decision D34).
  const mayConfirm =
    channel.kind !== "telegram" && !channel.verified && !about.blocked && canReach(notify, channel);
  return { channel, about, mayConfirm };
}

export type ChannelLinkPage =
  | {
      kind: "confirm" | "turnOff";
      channel: ConfirmableChannel["kind"];
      subject: ChannelSubject;
      /** An email address, shortened, as the link may be forwarded; nothing for ntfy. */
      address: string | undefined;
    }
  | { kind: "not_found" };

/**
 * What opening a channel's link shows (spec 3.2, decision D1: nothing changes on GET, since mail
 * scanners open links): confirming or refusing a channel that waits for it, else turning it off.
 */
export async function openChannelLink(deps: PlanDeps, token: string): Promise<ChannelLinkPage> {
  const target = await linkTarget(deps, token);
  if (target === undefined) return { kind: "not_found" };
  const { channel } = target;
  return {
    kind: target.mayConfirm ? "confirm" : "turnOff",
    channel: channel.kind,
    subject: target.about.subject,
    address: channel.kind === "email" ? maskEmailAddress(channel.address) : undefined,
  };
}

export async function useChannelLink(
  deps: PlanDeps,
  request: { token: string; action: "confirm" | "off" },
): Promise<
  { kind: "confirmed" | "off"; channel: ConfirmableChannel["kind"] } | { kind: "not_found" }
> {
  const target = await linkTarget(deps, request.token);
  const channels = deps.notify?.channels;
  if (target === undefined || channels === undefined) return { kind: "not_found" };
  const channel = target.channel.kind;
  if (request.action === "off") {
    await channels.delete(target.channel.id);
    return { kind: "off", channel };
  }
  if (!target.mayConfirm) return { kind: "not_found" };
  await channels.confirm(target.channel.id);
  return { kind: "confirmed", channel };
}

const CHANNEL_CONFIRMATION = "channelConfirmation";
const ACCOUNT_NOTICE = "accountNotice";

/** Queues the message with the channel's confirmation link, tied to its response or plan. */
export async function queueConfirmation(
  deps: PlanDeps,
  owner: ChannelOwner,
  channelId: string,
): Promise<void> {
  await deps.notify?.jobs.enqueue({
    type: CHANNEL_CONFIRMATION,
    payload: { channelId },
    ...ownerIds(owner),
    runAt: deps.clock.now(),
    expiresAt: undefined,
  });
}

export const jobOutcomeOf = (result: SendResult): JobOutcome =>
  result === "sent" ? "done" : result === "retry" ? "retry" : "drop";

function hasChannelId(value: unknown): value is { channelId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).channelId === "string"
  );
}

/**
 * Sends the confirmation link, unless the channel was confirmed, replaced or removed since, or its
 * owner was rejected or removed.
 */
export function channelConfirmationHandler(
  deps: ChannelDeps,
): (payload: unknown) => Promise<JobOutcome> {
  return async (payload) => {
    if (!hasChannelId(payload) || deps.notify === undefined) return "drop";
    const channel = await deps.notify.channels.findById(payload.channelId);
    if (channel === undefined || channel.kind === "webpush" || channel.verified) return "drop";
    const about = await aboutChannel(deps, channel);
    if (about === undefined || about.blocked) return "drop";
    const to = recipientOf(channel, about.language);
    if (to === undefined) return "drop";
    return jobOutcomeOf(
      await sendVia(deps.notify, channel, to, (outbox, recipient) =>
        outbox.confirmation(recipient, about.subject),
      ),
    );
  };
}

/** The expiry warning for one of an account's channels (decision I52). */
interface AccountNoticeJob {
  channelId: string;
  notice: "expiry";
  /** ISO 8601: the account's last use the warning is about; any later use cancels it. */
  lastActiveAt: string;
}

/**
 * Queues the warning for every confirmed channel of the account whose service is configured;
 * returns how many.
 */
export async function queueExpiryWarnings(
  deps: PlanDeps,
  identity: { id: string; lastActiveAt: Date },
): Promise<number> {
  const notify = deps.notify;
  if (notify === undefined) return 0;
  const channels = (await notify.channels.listFor({ identityId: identity.id })).filter(
    (channel) => channel.verified && channel.kind !== "webpush" && canReach(notify, channel),
  );
  for (const channel of channels) {
    await notify.jobs.enqueue({
      type: ACCOUNT_NOTICE,
      payload: {
        channelId: channel.id,
        notice: "expiry",
        lastActiveAt: identity.lastActiveAt.toISOString(),
      } satisfies AccountNoticeJob,
      runAt: deps.clock.now(),
      // Useless once the account is gone.
      expiresAt: accountDeleteAt(identity.lastActiveAt),
    });
  }
  return channels.length;
}

/**
 * Sends an account notice; the channel goes with its account, and so does the notice. A warning
 * is dropped once the account was used after it was queued: its date no longer holds.
 */
export function accountNoticeHandler(
  deps: ChannelDeps & { identities: Pick<IdentityRepository, "findById"> },
): (payload: unknown) => Promise<JobOutcome> {
  return async (payload) => {
    if (!isAccountNotice(payload) || deps.notify === undefined) return "drop";
    const channel = await deps.notify.channels.findById(payload.channelId);
    if (channel === undefined || channel.kind === "webpush") return "drop";
    if (!("identityId" in channel.owner)) return "drop";
    const identity = await deps.identities.findById(channel.owner.identityId);
    const lastActiveAt = new Date(payload.lastActiveAt);
    if (identity === undefined || identity.lastActiveAt.getTime() > lastActiveAt.getTime()) {
      return "drop";
    }
    const to = await confirmedRecipient(deps, channel);
    if (to === undefined) return "drop";
    const deleteAt = accountDeleteAt(lastActiveAt);
    return jobOutcomeOf(
      await sendVia(deps.notify, channel, to, (outbox, recipient) =>
        outbox.accountExpiry(recipient, deleteAt),
      ),
    );
  };
}

function isAccountNotice(value: unknown): value is AccountNoticeJob {
  if (!hasChannelId(value)) return false;
  const { notice, lastActiveAt } = value as unknown as Record<string, unknown>;
  return (
    notice === "expiry" &&
    typeof lastActiveAt === "string" &&
    !Number.isNaN(Date.parse(lastActiveAt))
  );
}
