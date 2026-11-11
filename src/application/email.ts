// Email (spec 7 Optional notification channels, decision D31): one address per response or hosted
// plan, typed on the manage or host page, and one for the account, on the account page. Nothing but
// the confirmation link is sent to an address until that link is used; that link refuses the
// emails too, and every later message carries it to turn them off. An account's confirmed address
// can be used for a plan or response without confirming it again. Rejected and removed people may
// only turn emails off (spec 3.5). Without SMTP (also when it is switched off later), stored
// addresses can still be turned off.
import { type EmailAddressError, maskEmailAddress, parseEmailAddress } from "../domain/email.ts";
import { accountDeleteAt } from "../domain/expiry.ts";
import { DEFAULT_NOTICE_LANGUAGE } from "../domain/notification.ts";
import { isBlocked } from "../domain/response.ts";
import { ownerFor, type SwitchRequest } from "./channels.ts";
import { resolveDevice } from "./devices.ts";
import { type Denied, isDenied } from "./host.ts";
import type { JobOutcome } from "./jobs.ts";
import { ownerIds } from "./notify.ts";
import type { PlanDeps } from "./plans.ts";
import type {
  ChannelOwner,
  ChannelRepository,
  EmailChannel,
  EmailOutbox,
  EmailRecipient,
  EmailSubject,
  IdentityRepository,
  SendResult,
} from "./ports.ts";

type Unavailable = { kind: "unavailable" };
const UNAVAILABLE: Unavailable = { kind: "unavailable" };

/** The channel repository, jobs and links, and the outbox while SMTP is configured. */
function emailDeps(deps: PlanDeps) {
  const notify = deps.notify;
  return notify?.email === undefined
    ? undefined
    : {
        channels: notify.channels,
        jobs: notify.jobs,
        links: notify.email.links,
        outbox: notify.email.outbox,
      };
}
type EmailDeps = NonNullable<ReturnType<typeof emailDeps>>;

export type EmailSetting =
  | {
      kind: "setting";
      state: "off";
      /** The logged-in account's confirmed address, offered for a plan or response (D31). */
      accountAddress: string | undefined;
    }
  | {
      kind: "setting";
      state: "pending" | "on";
      address: string;
      /** False once SMTP is switched off: the address can only be turned off. */
      sending: boolean;
    };

/** The account this device is logged in to, as a channel owner. */
async function accountOf(
  deps: PlanDeps,
  deviceToken: string | undefined,
): Promise<{ identityId: string } | undefined> {
  const identityId = (await resolveDevice(deps, deviceToken))?.identityId;
  return identityId === undefined ? undefined : { identityId };
}

/** A confirmed address of the account, which it may lend to its plans and responses. */
async function confirmedAccountEmail(
  email: EmailDeps,
  account: { identityId: string } | undefined,
): Promise<EmailChannel | undefined> {
  if (account === undefined) return undefined;
  const channel = await email.channels.emailFor(account);
  return channel?.verified === true ? channel : undefined;
}

async function settingFor(
  email: EmailDeps,
  owner: ChannelOwner,
  /** The account whose address could be lent; looked up only when one is offered. */
  account: () => Promise<{ identityId: string } | undefined>,
): Promise<EmailSetting | Unavailable> {
  const channel = await email.channels.emailFor(owner);
  const sending = email.outbox !== undefined;
  if (channel === undefined) {
    if (!sending) return UNAVAILABLE;
    const lent = await confirmedAccountEmail(email, await account());
    return { kind: "setting", state: "off", accountAddress: lent?.address };
  }
  return {
    kind: "setting",
    state: channel.verified ? "on" : "pending",
    address: channel.address,
    sending,
  };
}

/** What the manage or host page shows: no address, one waiting for confirmation, or one in use. */
export async function emailSetting(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<EmailSetting | Unavailable | Denied> {
  const email = emailDeps(deps);
  if (email === undefined) return UNAVAILABLE;
  const owner = await ownerFor(deps, request, "manage");
  if (isDenied(owner)) return owner;
  return settingFor(email, owner, () => accountOf(deps, request.deviceToken));
}

/** The account page's address (decision D31); undefined when the device is not logged in. */
export async function accountEmailSetting(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<EmailSetting | Unavailable> {
  const email = emailDeps(deps);
  const account = await accountOf(deps, request.deviceToken);
  if (email === undefined || account === undefined) return UNAVAILABLE;
  return settingFor(email, account, () => Promise.resolve(undefined));
}

type RequestResult =
  | { kind: "sent" }
  | { kind: "unchanged" }
  | { kind: "invalid"; error: EmailAddressError }
  | Unavailable;

/**
 * Sets the address and sends the link that confirms it. The same address again sends the same
 * link again while it waits, and changes nothing once confirmed; another address replaces it.
 */
async function requestFor(
  deps: PlanDeps,
  email: EmailDeps,
  owner: ChannelOwner,
  typed: string,
  language: string | undefined,
): Promise<RequestResult> {
  const address = parseEmailAddress(typed);
  if (!address.ok) return { kind: "invalid", error: address.error };
  const existing = await email.channels.emailFor(owner);
  if (existing?.address === address.value && existing.verified) return { kind: "unchanged" };
  const channelId =
    existing?.address === address.value
      ? existing.id
      : await email.channels.setEmail(owner, address.value, language);
  await email.jobs.enqueue({
    type: EMAIL_CONFIRMATION,
    payload: { channelId } satisfies ConfirmationJob,
    ...ownerIds(owner),
    runAt: deps.clock.now(),
    expiresAt: undefined,
  });
  return { kind: "sent" };
}

export async function requestEmail(
  deps: PlanDeps,
  request: SwitchRequest & { address: string },
): Promise<RequestResult | Denied> {
  const email = emailDeps(deps);
  if (email?.outbox === undefined) return UNAVAILABLE;
  const owner = await ownerFor(deps, request, "subscribe");
  if (isDenied(owner)) return owner;
  return requestFor(deps, email, owner, request.address, undefined);
}

/** The account's address, written in the page's language, which later notices use. */
export async function requestAccountEmail(
  deps: PlanDeps,
  request: { deviceToken: string | undefined; address: string; language: string },
): Promise<RequestResult> {
  const email = emailDeps(deps);
  const account = await accountOf(deps, request.deviceToken);
  if (email?.outbox === undefined || account === undefined) return UNAVAILABLE;
  return requestFor(deps, email, account, request.address, request.language);
}

/**
 * The account's confirmed address for one of its device's plans or responses, at once: it was
 * confirmed already (decision D31).
 */
export async function useAccountEmail(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<{ kind: "set" } | Unavailable | Denied> {
  const email = emailDeps(deps);
  if (email?.outbox === undefined) return UNAVAILABLE;
  const owner = await ownerFor(deps, request, "subscribe");
  if (isDenied(owner)) return owner;
  const lent = await confirmedAccountEmail(email, await accountOf(deps, request.deviceToken));
  if (lent === undefined) return UNAVAILABLE;
  await email.channels.confirm(await email.channels.setEmail(owner, lent.address));
  return { kind: "set" };
}

async function turnOffFor(email: EmailDeps, owner: ChannelOwner): Promise<{ kind: "off" }> {
  const channel = await email.channels.emailFor(owner);
  if (channel !== undefined) await email.channels.delete(channel.id);
  return { kind: "off" };
}

export async function turnOffEmail(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<{ kind: "off" } | Unavailable | Denied> {
  const email = emailDeps(deps);
  if (email === undefined) return UNAVAILABLE;
  const owner = await ownerFor(deps, request, "manage");
  if (isDenied(owner)) return owner;
  return turnOffFor(email, owner);
}

export async function turnOffAccountEmail(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "off" } | Unavailable> {
  const email = emailDeps(deps);
  const account = await accountOf(deps, request.deviceToken);
  if (email === undefined || account === undefined) return UNAVAILABLE;
  return turnOffFor(email, account);
}

/** The address of a plan, response or account as its export lists it (spec 3.7). */
export async function exportedEmail(
  deps: PlanDeps,
  owner: ChannelOwner,
): Promise<{ address: string; confirmed: boolean } | undefined> {
  const channel = await deps.notify?.channels.emailFor(owner);
  return channel === undefined
    ? undefined
    : { address: channel.address, confirmed: channel.verified };
}

/** What an email channel is for, in which language to write, and whether its owner is out. */
interface ChannelAbout {
  subject: EmailSubject;
  language: string;
  /** Rejected or removed (spec 3.5): the address can only be turned off. */
  blocked: boolean;
}

async function aboutChannel(
  deps: Pick<PlanDeps, "plans" | "responses">,
  channel: EmailChannel,
): Promise<ChannelAbout | undefined> {
  const { owner } = channel;
  if ("identityId" in owner) {
    // Goes with its account; written in the language the address was set in.
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

/**
 * A confirmed address as the outbox writes to it, in its owner's language; none for rejected and
 * removed people, who may only turn emails off (spec 3.5).
 */
export async function confirmedRecipient(
  deps: Pick<PlanDeps, "plans" | "responses">,
  channel: EmailChannel | undefined,
): Promise<EmailRecipient | undefined> {
  if (channel === undefined || !channel.verified) return undefined;
  const about = await aboutChannel(deps, channel);
  return about === undefined || about.blocked
    ? undefined
    : { channelId: channel.id, address: channel.address, language: about.language };
}

/** The email channel behind a link, what it is about, and whether it may still be confirmed. */
async function linkTarget(
  deps: PlanDeps,
  token: string,
): Promise<{ channel: EmailChannel; about: ChannelAbout; mayConfirm: boolean } | undefined> {
  const email = emailDeps(deps);
  const channelId = email?.links.channelOf(token);
  if (email === undefined || channelId === undefined) return undefined;
  const channel = await email.channels.findById(channelId);
  if (channel?.kind !== "email") return undefined;
  const about = await aboutChannel(deps, channel);
  if (about === undefined) return undefined;
  const mayConfirm = !channel.verified && !about.blocked && email.outbox !== undefined;
  return { channel, about, mayConfirm };
}

export type EmailLinkPage =
  | { kind: "confirm" | "turnOff"; subject: EmailSubject; address: string }
  | { kind: "not_found" };

/**
 * What opening an email's link shows (spec 3.2, decision D1: nothing changes on GET, since mail
 * scanners open links): confirming or refusing an address that waits for it, else turning the
 * emails off. The address is shortened, as the link may be forwarded.
 */
export async function openEmailLink(deps: PlanDeps, token: string): Promise<EmailLinkPage> {
  const target = await linkTarget(deps, token);
  if (target === undefined) return { kind: "not_found" };
  return {
    kind: target.mayConfirm ? "confirm" : "turnOff",
    subject: target.about.subject,
    address: maskEmailAddress(target.channel.address),
  };
}

export async function useEmailLink(
  deps: PlanDeps,
  request: { token: string; action: "confirm" | "off" },
): Promise<{ kind: "confirmed" } | { kind: "off" } | { kind: "not_found" }> {
  const target = await linkTarget(deps, request.token);
  const channels = deps.notify?.channels;
  if (target === undefined || channels === undefined) return { kind: "not_found" };
  if (request.action === "off") {
    await channels.delete(target.channel.id);
    return { kind: "off" };
  }
  if (!target.mayConfirm) return { kind: "not_found" };
  await channels.confirm(target.channel.id);
  return { kind: "confirmed" };
}

const EMAIL_CONFIRMATION = "emailConfirmation";
const REPORT_ALERT = "reportAlert";
const ACCOUNT_NOTICE = "accountNotice";

interface ConfirmationJob {
  channelId: string;
}

const jobOutcomeOf = (result: SendResult): JobOutcome =>
  result === "sent" ? "done" : result === "retry" ? "retry" : "drop";

/** The parts of the plan dependencies the email jobs read. */
type JobDeps = {
  notify?: { channels: ChannelRepository } | undefined;
  responses: PlanDeps["responses"];
  plans: PlanDeps["plans"];
  outbox: EmailOutbox;
};

/**
 * Sends the confirmation link, unless the address was confirmed, replaced or removed since, or its
 * owner was rejected or removed.
 */
export function emailConfirmationHandler(deps: JobDeps): (payload: unknown) => Promise<JobOutcome> {
  return async (payload) => {
    if (!hasChannelId(payload) || deps.notify === undefined) return "drop";
    const channel = await deps.notify.channels.findById(payload.channelId);
    if (channel?.kind !== "email" || channel.verified) return "drop";
    const about = await aboutChannel(deps, channel);
    if (about === undefined || about.blocked) return "drop";
    return jobOutcomeOf(
      await deps.outbox.confirmation(
        { channelId: channel.id, address: channel.address, language: about.language },
        about.subject,
      ),
    );
  };
}

function hasChannelId(value: unknown): value is { channelId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).channelId === "string"
  );
}

/** Queues the alert for a new report (spec 7 Moderation): the job carries nothing of it. */
export async function queueReportAlert(deps: PlanDeps, planId: string): Promise<void> {
  const notify = deps.notify;
  if (notify?.email?.reportAlerts !== true) return;
  await notify.jobs.enqueue({
    type: REPORT_ALERT,
    payload: {},
    planId,
    responseId: undefined,
    runAt: deps.clock.now(),
    expiresAt: undefined,
  });
}

export function reportAlertHandler(deps: {
  outbox: EmailOutbox;
}): (payload: unknown) => Promise<JobOutcome> {
  return async () => jobOutcomeOf(await deps.outbox.reportAlert());
}

/** The expiry warning for one of an account's channels (decision I52). */
interface AccountNoticeJob {
  channelId: string;
  notice: "expiry";
  /** ISO 8601: the account's last use the warning is about; any later use cancels it. */
  lastActiveAt: string;
}

/** Queues the warning for every confirmed channel of the account; returns how many. */
export async function queueExpiryWarnings(
  deps: PlanDeps,
  identity: { id: string; lastActiveAt: Date },
): Promise<number> {
  const deleteAt = accountDeleteAt(identity.lastActiveAt);
  const notify = deps.notify;
  if (notify?.email?.outbox === undefined) return 0;
  const channels = (await notify.channels.listFor({ identityId: identity.id })).filter(
    (channel) => channel.verified && channel.kind === "email",
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
      expiresAt: deleteAt,
    });
  }
  return channels.length;
}

/**
 * Sends an account notice; the channel goes with its account, and so does the notice. A warning
 * is dropped once the account was used after it was queued: its date no longer holds.
 */
export function accountNoticeHandler(
  deps: JobDeps & { identities: Pick<IdentityRepository, "findById"> },
): (payload: unknown) => Promise<JobOutcome> {
  return async (payload) => {
    if (!isAccountNotice(payload) || deps.notify === undefined) return "drop";
    const channel = await deps.notify.channels.findById(payload.channelId);
    if (channel?.kind !== "email" || !("identityId" in channel.owner)) return "drop";
    const identity = await deps.identities.findById(channel.owner.identityId);
    const lastActiveAt = new Date(payload.lastActiveAt);
    if (identity === undefined || identity.lastActiveAt.getTime() > lastActiveAt.getTime()) {
      return "drop";
    }
    const to = await confirmedRecipient(deps, channel);
    if (to === undefined) return "drop";
    return jobOutcomeOf(await deps.outbox.accountExpiry(to, accountDeleteAt(lastActiveAt)));
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
