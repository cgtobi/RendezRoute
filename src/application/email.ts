// Email (spec 7 Optional notification channels, decision D31): one address per response or hosted
// plan, typed on the manage or host page, and one for the account, on the account page. An
// account's confirmed address can be used for a plan or response without confirming it again.
// Confirming, refusing and turning off go through the channel's link (channel-links.ts). Without
// SMTP (also when it is switched off later), stored addresses can still be turned off.
import { type EmailAddressError, parseEmailAddress } from "../domain/email.ts";
import { ownerFor, type SwitchRequest } from "./channels.ts";
import { accountOf, jobOutcomeOf, queueConfirmation } from "./channel-links.ts";
import { type Denied, isDenied } from "./host.ts";
import type { JobOutcome } from "./jobs.ts";
import type { PlanDeps } from "./plans.ts";
import type {
  ChannelOwner,
  EmailChannel,
  EmailOutbox,
  ReportAlertState,
  ReportRepository,
} from "./ports.ts";

type Unavailable = { kind: "unavailable" };
const UNAVAILABLE: Unavailable = { kind: "unavailable" };

/** The channel repository, and the outbox while SMTP is configured. */
function emailDeps(deps: PlanDeps) {
  const notify = deps.notify;
  return notify?.email === undefined
    ? undefined
    : { channels: notify.channels, outbox: notify.email.outbox };
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
  await queueConfirmation(deps, owner, channelId);
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

const REPORT_ALERT = "reportAlert";

const ALERT_SPACING_MS = 3_600_000;

/**
 * At most one report alert email an hour for the instance (0.19.0): the first report alerts at
 * once, later ones share one alert at the end of the hour, which names how many reports are open
 * when it goes out. The time of the latest alert is stored (`ReportAlertState`), so a restart
 * neither forgets the hour nor a batch still waiting: an alert due later is that pending batch.
 *
 * Order: the time is reserved in memory at once (so reports arriving together see each other),
 * then the job is queued, and only then is the time stored. A crash in between can at worst send
 * one alert too many, never lose one; a failing store is ignored (an extra email beats a lost
 * alert), and a failing queue gives the reservation back.
 */
export interface ReportAlertThrottle {
  /**
   * Queues the alert for a report arriving now through `enqueue`, called with the time it should
   * go out, unless one is already pending. Throws only what `enqueue` throws, after the
   * reservation was given back.
   */
  schedule(now: Date, enqueue: (runAt: Date) => Promise<void>): Promise<void>;
}

export function createReportAlertThrottle(
  state: ReportAlertState = memoryAlertState(),
): ReportAlertThrottle {
  /** The latest alert's time as stored; read once, then kept here and written through. */
  let loaded: Promise<void> | undefined;
  let latest = 0;
  return {
    schedule: async (now, enqueue) => {
      const current = (loaded ??= state.read().then((at) => {
        latest = at?.getTime() ?? 0;
      }));
      try {
        await current;
      } catch {
        if (loaded === current) loaded = undefined;
        // Fail open: the state cannot be read, so alert now.
        return enqueue(now);
      }
      // From here to the queueing there is no await before `latest` changes.
      const time = now.getTime();
      // A pending alert is at most an hour away; a later time is stale (a clock that jumped back,
      // a restored database) and would hold alerts back.
      if (latest > time + ALERT_SPACING_MS) latest = 0;
      if (latest > time) return;
      const previous = latest;
      const at = Math.max(time, latest + ALERT_SPACING_MS);
      latest = at;
      try {
        await enqueue(new Date(at));
      } catch (error) {
        // Reports folded into this reservation while it was being queued get no alert of their
        // own. If a later reservation failed too, its rollback restores this one's time (and this
        // one finds `latest` changed and leaves it): the time then stands with no job behind it
        // and the next report is delayed by at most the spacing. Delayed, never lost for good,
        // and only while the queue cannot write.
        if (latest === at) latest = previous;
        throw error;
      }
      try {
        await state.write(new Date(at));
      } catch {
        // The alert is queued; only a restart in this hour could now send one more.
      }
    },
  };
}

function memoryAlertState(): ReportAlertState {
  let at: Date | undefined;
  return {
    read: () => Promise.resolve(at),
    write: (value) => {
      at = value;
      return Promise.resolve();
    },
  };
}

/**
 * Queues the alert for a new report (spec 7 Moderation): the job carries nothing of it. The report
 * is stored already, so a failure here is never passed on to the reporter.
 */
export async function queueReportAlert(deps: PlanDeps): Promise<void> {
  const notify = deps.notify;
  if (notify?.email?.reportAlerts !== true) return;
  const now = deps.clock.now();
  const enqueue = async (runAt: Date) => {
    await notify.jobs.enqueue({
      type: REPORT_ALERT,
      payload: {},
      // Bound to no plan: the job cascades with its plan, and the alert it carries is shared by
      // reports of other plans, so deleting the reported plan must not lose it.
      planId: undefined,
      responseId: undefined,
      runAt,
      expiresAt: undefined,
    });
  };
  try {
    const throttle = notify.email.alertThrottle;
    await (throttle === undefined ? enqueue(now) : throttle.schedule(now, enqueue));
  } catch {
    // The queue is unavailable (disk full): the report stands, the next one alerts again.
  }
}

export function reportAlertHandler(deps: {
  outbox: EmailOutbox;
  reports: Pick<ReportRepository, "countOpen">;
}): (payload: unknown) => Promise<JobOutcome> {
  return async () => {
    // The count is taken when the alert goes out: reports resolved meanwhile need no alert.
    const open = await deps.reports.countOpen();
    if (open === 0) return "done";
    return jobOutcomeOf(await deps.outbox.reportAlert(open));
  };
}
