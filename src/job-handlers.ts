// The background jobs and what runs them (spec 6 feature 12): notifications by browser push or
// email, and the emails that are not notifications (decision D31). Wiring shared by the server
// (main.ts) and the tests.
import { createChannelNotifier } from "./adapters/out/channel-notifier.ts";
import type { Mailer } from "./adapters/out/email/mailer.ts";
import type { EmailInstance } from "./adapters/out/email/messages.ts";
import { createEmailDelivery, createEmailOutbox } from "./adapters/out/email/notifier.ts";
import { emailConfirmationHandler, reportAlertHandler } from "./application/email.ts";
import type { JobHandlers } from "./application/jobs.ts";
import { notificationHandler } from "./application/notifications.ts";
import type { PlanDeps } from "./application/plans.ts";
import type { ChannelLinks, Notifier } from "./application/ports.ts";
import { reminderStillDue } from "./application/reminders.ts";
import type { JobType } from "./domain/jobs.ts";

export interface EmailWiring extends EmailInstance {
  mailer: Mailer;
  links: ChannelLinks;
  /** Report alerts go here; none without it. */
  contactEmail: string | undefined;
}

export function createJobHandlers({
  planDeps,
  push,
  email,
}: {
  planDeps: PlanDeps;
  push: Notifier;
  /** Undefined without SMTP: email jobs are dropped. */
  email: EmailWiring | undefined;
}): JobHandlers & Record<JobType, JobHandlers[string]> {
  const notify = planDeps.notify;
  if (notify === undefined) throw new Error("notification dependencies missing");
  const outbox = email === undefined ? undefined : createEmailOutbox(email);
  const notifier = createChannelNotifier({
    channels: notify.channels,
    push,
    email: email === undefined ? undefined : createEmailDelivery(email),
  });
  const dropped = () => Promise.resolve("drop" as const);
  return {
    notification: notificationHandler({
      notifier,
      onGone: (channelId) => notify.channels.delete(channelId),
      stillDue: (reminder) => reminderStillDue(planDeps, reminder),
    }),
    emailConfirmation:
      outbox === undefined ? dropped : emailConfirmationHandler({ ...planDeps, outbox }),
    reportAlert: outbox === undefined ? dropped : reportAlertHandler({ outbox }),
  };
}
