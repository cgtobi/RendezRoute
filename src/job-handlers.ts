// The background jobs and what runs them (spec 6 feature 12): notifications by browser push,
// email, ntfy or Telegram, and the messages that are not notifications (decisions D31, D33,
// D34): confirmations, report alerts and account notices. Wiring shared by the server (main.ts)
// and the tests.
import { createChannelNotifier } from "./adapters/out/channel-notifier.ts";
import type { FederationOutbound } from "./adapters/out/federation/outbound.ts";
import type { EmailDelivery } from "./adapters/out/email/notifier.ts";
import type { NtfyDelivery } from "./adapters/out/ntfy/notifier.ts";
import type { TelegramDelivery } from "./adapters/out/telegram/notifier.ts";
import { accountNoticeHandler, channelConfirmationHandler } from "./application/channel-links.ts";
import { reportAlertHandler } from "./application/email.ts";
import type { JobHandlers, JobOutcome } from "./application/jobs.ts";
import { notificationHandler } from "./application/notifications.ts";
import type { PlanDeps } from "./application/plans.ts";
import type { IdentityRepository, Notifier } from "./application/ports.ts";
import { reminderStillDue } from "./application/reminders.ts";
import type { JobType } from "./domain/jobs.ts";

export function createJobHandlers({
  planDeps,
  push,
  email,
  ntfy,
  telegram,
  identities,
  federation,
}: {
  planDeps: PlanDeps;
  /** Account notices check that the account was not used since they were queued. */
  identities: Pick<IdentityRepository, "findById">;
  push: Notifier;
  /** Undefined while their service is not configured; their outboxes are in the plan dependencies. */
  email: EmailDelivery | undefined;
  ntfy: NtfyDelivery | undefined;
  telegram: TelegramDelivery | undefined;
  /** Deliveries to fediverse inboxes (decision D38); undefined while federation is off. */
  federation: Pick<FederationOutbound, "deliver"> | undefined;
}): Record<JobType, JobHandlers[string]> {
  const notify = planDeps.notify;
  if (notify === undefined) throw new Error("notification dependencies missing");
  const emailOutbox = notify.email?.outbox;
  const dropped = () => Promise.resolve<JobOutcome>("drop");
  return {
    notification: notificationHandler({
      notifier: createChannelNotifier({ channels: notify.channels, push, email, ntfy, telegram }),
      onGone: (channelId) => notify.channels.delete(channelId),
      stillDue: (reminder) => reminderStillDue(planDeps, reminder),
    }),
    channelConfirmation: channelConfirmationHandler(planDeps),
    reportAlert:
      emailOutbox === undefined
        ? dropped
        : reportAlertHandler({ outbox: emailOutbox, reports: planDeps.reports }),
    accountNotice: accountNoticeHandler({ ...planDeps, identities }),
    federationDelivery: federation?.deliver ?? dropped,
  };
}
