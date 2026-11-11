// Email notifications (spec 7 Optional notification channels, decision D31): one address per
// response or hosted plan, typed on the manage or host page. Nothing but the confirmation link is
// sent to it until that link is used; that link refuses the emails too, and every later message
// carries it to turn them off. Rejected and removed people may only turn emails off (spec 3.5).
// Without SMTP (also when it is switched off later), stored addresses can still be turned off.
import { type EmailAddressError, maskEmailAddress, parseEmailAddress } from "../domain/email.ts";
import { isBlocked } from "../domain/response.ts";
import { ownerFor, type SwitchRequest } from "./channels.ts";
import { type Denied, isDenied } from "./host.ts";
import type { JobOutcome } from "./jobs.ts";
import { ownerIds } from "./notify.ts";
import type { PlanDeps } from "./plans.ts";
import type {
  ChannelOwner,
  ChannelRepository,
  EmailChannel,
  EmailOutbox,
  SendResult,
} from "./ports.ts";

type Unavailable = { kind: "unavailable" };
const UNAVAILABLE: Unavailable = { kind: "unavailable" };

/** The channel repository, jobs and links, and whether emails can be sent (SMTP configured). */
function emailDeps(deps: PlanDeps) {
  const notify = deps.notify;
  return notify?.email === undefined
    ? undefined
    : {
        channels: notify.channels,
        jobs: notify.jobs,
        links: notify.email.links,
        sending: notify.email.sending,
      };
}

export type EmailSetting =
  | { kind: "setting"; state: "off" }
  | {
      kind: "setting";
      state: "pending" | "on";
      address: string;
      /** False once SMTP is switched off: the address can only be turned off. */
      sending: boolean;
    };

/** What the manage or host page shows: no address, one waiting for confirmation, or one in use. */
export async function emailSetting(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<EmailSetting | Unavailable | Denied> {
  const email = emailDeps(deps);
  if (email === undefined) return UNAVAILABLE;
  const owner = await ownerFor(deps, request, "manage");
  if (isDenied(owner)) return owner;
  const channel = await email.channels.emailFor(owner);
  if (channel === undefined) return email.sending ? { kind: "setting", state: "off" } : UNAVAILABLE;
  return {
    kind: "setting",
    state: channel.verified ? "on" : "pending",
    address: channel.address,
    sending: email.sending,
  };
}

/**
 * Sets the address and sends the link that confirms it. The same address again sends the same
 * link again while it waits, and changes nothing once confirmed; another address replaces it.
 */
export async function requestEmail(
  deps: PlanDeps,
  request: SwitchRequest & { address: string },
): Promise<
  | { kind: "sent" }
  | { kind: "unchanged" }
  | { kind: "invalid"; error: EmailAddressError }
  | Unavailable
  | Denied
> {
  const email = emailDeps(deps);
  if (email === undefined || !email.sending) return UNAVAILABLE;
  const owner = await ownerFor(deps, request, "subscribe");
  if (isDenied(owner)) return owner;
  const address = parseEmailAddress(request.address);
  if (!address.ok) return { kind: "invalid", error: address.error };
  const existing = await email.channels.emailFor(owner);
  if (existing?.address === address.value && existing.verified) return { kind: "unchanged" };
  const channelId =
    existing?.address === address.value
      ? existing.id
      : await email.channels.setEmail(owner, address.value);
  await email.jobs.enqueue({
    type: EMAIL_CONFIRMATION,
    payload: { channelId } satisfies ConfirmationJob,
    ...ownerIds(owner),
    runAt: deps.clock.now(),
    expiresAt: undefined,
  });
  return { kind: "sent" };
}

export async function turnOffEmail(
  deps: PlanDeps,
  request: SwitchRequest,
): Promise<{ kind: "off" } | Unavailable | Denied> {
  const email = emailDeps(deps);
  if (email === undefined) return UNAVAILABLE;
  const owner = await ownerFor(deps, request, "manage");
  if (isDenied(owner)) return owner;
  const channel = await email.channels.emailFor(owner);
  if (channel !== undefined) await email.channels.delete(channel.id);
  return { kind: "off" };
}

/** The plan an email channel is about, in its owner's language, and whether the owner is out. */
interface ChannelAbout {
  planTitle: string;
  language: string;
  /** Rejected or removed (spec 3.5): the address can only be turned off. */
  blocked: boolean;
}

async function aboutOwner(
  deps: Pick<PlanDeps, "plans" | "responses">,
  owner: ChannelOwner,
): Promise<ChannelAbout | undefined> {
  const response =
    "responseId" in owner ? await deps.responses.findById(owner.responseId) : undefined;
  const planId = "planId" in owner ? owner.planId : response?.planId;
  const plan = planId === undefined ? undefined : await deps.plans.findById(planId);
  if (plan === undefined) return undefined;
  return {
    planTitle: plan.title,
    language: response?.language ?? plan.posterLanguage,
    blocked: response !== undefined && isBlocked(response.kind),
  };
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
  const about = await aboutOwner(deps, channel.owner);
  if (about === undefined) return undefined;
  return { channel, about, mayConfirm: !channel.verified && !about.blocked && email.sending };
}

export type EmailLinkPage =
  | { kind: "confirm" | "turnOff"; planTitle: string; address: string }
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
    planTitle: target.about.planTitle,
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

interface ConfirmationJob {
  channelId: string;
}

const jobOutcomeOf = (result: SendResult): JobOutcome =>
  result === "sent" ? "done" : result === "retry" ? "retry" : "drop";

/**
 * Sends the confirmation link, unless the address was confirmed, replaced or removed since, or its
 * owner was rejected or removed.
 */
export function emailConfirmationHandler(deps: {
  notify?: { channels: ChannelRepository } | undefined;
  responses: PlanDeps["responses"];
  plans: PlanDeps["plans"];
  outbox: EmailOutbox;
}): (payload: unknown) => Promise<JobOutcome> {
  return async (payload) => {
    if (!isConfirmationJob(payload) || deps.notify === undefined) return "drop";
    const channel = await deps.notify.channels.findById(payload.channelId);
    if (channel?.kind !== "email" || channel.verified) return "drop";
    const about = await aboutOwner(deps, channel.owner);
    if (about === undefined || about.blocked) return "drop";
    return jobOutcomeOf(
      await deps.outbox.confirmation(
        { channelId: channel.id, address: channel.address },
        { planTitle: about.planTitle, language: about.language },
      ),
    );
  };
}

function isConfirmationJob(value: unknown): value is ConfirmationJob {
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
