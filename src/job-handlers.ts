// The background jobs and what runs them (spec 6 feature 12): notifications by browser push or
// email, and the emails that are not notifications (decision D31). Wiring shared by the server
// (main.ts) and the tests.
import { createChannelNotifier } from "./adapters/out/channel-notifier.ts";
import type { EmailDelivery } from "./adapters/out/email/notifier.ts";
import {
  accountNoticeHandler,
  emailConfirmationHandler,
  reportAlertHandler,
} from "./application/email.ts";
import type { JobHandlers, JobOutcome } from "./application/jobs.ts";
import { notificationHandler } from "./application/notifications.ts";
import type { PlanDeps } from "./application/plans.ts";
import type { IdentityRepository, Notifier } from "./application/ports.ts";
import { reminderStillDue } from "./application/reminders.ts";
import type { JobType } from "./domain/jobs.ts";

export function createJobHandlers({
  planDeps,
  push,
  delivery,
  identities,
}: {
  planDeps: PlanDeps;
  /** Account notices check that the account was not used since they were queued. */
  identities: Pick<IdentityRepository, "findById">;
  push: Notifier;
  /** Undefined without SMTP: email jobs are dropped (the outbox is in the plan dependencies). */
  delivery: EmailDelivery | undefined;
}): Record<JobType, JobHandlers[string]> {
  const notify = planDeps.notify;
  if (notify === undefined) throw new Error("notification dependencies missing");
  const outbox = notify.email?.outbox;
  const dropped = () => Promise.resolve<JobOutcome>("drop");
  const jobDeps = outbox === undefined ? undefined : { ...planDeps, outbox };
  return {
    notification: notificationHandler({
      notifier: createChannelNotifier({ channels: notify.channels, push, email: delivery }),
      onGone: (channelId) => notify.channels.delete(channelId),
      stillDue: (reminder) => reminderStillDue(planDeps, reminder),
    }),
    emailConfirmation: jobDeps === undefined ? dropped : emailConfirmationHandler(jobDeps),
    reportAlert: jobDeps === undefined ? dropped : reportAlertHandler(jobDeps),
    accountNotice:
      jobDeps === undefined ? dropped : accountNoticeHandler({ ...jobDeps, identities }),
  };
}
