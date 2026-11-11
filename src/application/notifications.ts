// Notifications as jobs (spec 6 features 3 and 12): one job per channel, delivered by the
// Notifier with retries; a channel that is gone is reported so it can be removed.
import { parseEmailAddress } from "../domain/email.ts";
import { isNotification, type Notification } from "../domain/notification.ts";
import { parsePushSubscription } from "../domain/push.ts";
import { REMINDER_KINDS } from "../domain/reminders.ts";
import type { JobOutcome } from "./jobs.ts";
import type { Clock, JobQueue, NotificationTarget, Notifier, SentReminder } from "./ports.ts";

/** A reminder as carried in a job, checked again before it is sent (decision I39). */
type CarriedReminder = Omit<SentReminder, "dueAt"> & { dueAt: string };

interface NotificationJob {
  to: NotificationTarget;
  notification: Notification;
  reminder?: CarriedReminder | undefined;
}

interface NotificationRequest {
  to: NotificationTarget;
  notification: Notification;
  /** For a reminder: dropped at delivery if it is no longer due. */
  reminder?: SentReminder | undefined;
}

export function enqueueNotification(
  deps: { jobs: JobQueue; clock: Clock },
  request: NotificationRequest & {
    /** Ties the job to its plan or response, so deleting them removes it (spec 3.10). */
    planId?: string | undefined;
    responseId?: string | undefined;
    runAt?: Date | undefined;
    expiresAt?: Date | undefined;
  },
): Promise<string> {
  const { to, notification, reminder } = request;
  const payload: NotificationJob = {
    to,
    notification,
    ...(reminder === undefined
      ? {}
      : { reminder: { ...reminder, dueAt: reminder.dueAt.toISOString() } }),
  };
  return deps.jobs.enqueue({
    type: "notification",
    payload,
    planId: request.planId,
    responseId: request.responseId,
    runAt: request.runAt ?? deps.clock.now(),
    expiresAt: request.expiresAt,
  });
}

export function notificationHandler(deps: {
  notifier: Notifier;
  /** Called when a channel no longer exists, e.g. to delete its row. */
  onGone?: (channelId: string) => Promise<void>;
  /** Whether a queued reminder is still due: its plan or recipient may have changed since. */
  stillDue?: (reminder: SentReminder) => Promise<boolean>;
}): (payload: unknown) => Promise<JobOutcome> {
  return async (payload) => {
    if (!isNotificationJob(payload)) return "drop";
    const { reminder } = payload;
    if (reminder !== undefined && deps.stillDue !== undefined) {
      if (!(await deps.stillDue({ ...reminder, dueAt: new Date(reminder.dueAt) }))) return "drop";
    }
    const result = await deps.notifier.send(payload.to, payload.notification);
    if (result === "sent") return "done";
    if (result === "retry") return "retry";
    if (result === "gone" && "channelId" in payload.to) await deps.onGone?.(payload.to.channelId);
    return "drop";
  };
}

function isNotificationJob(value: unknown): value is NotificationJob {
  if (typeof value !== "object" || value === null) return false;
  const { to, notification, reminder } = value as Record<string, unknown>;
  return (
    isNotificationTarget(to) &&
    isNotification(notification) &&
    (reminder === undefined || isCarriedReminder(reminder))
  );
}

function isCarriedReminder(value: unknown): value is CarriedReminder {
  if (typeof value !== "object" || value === null) return false;
  const { kind, planId, responseId, dueAt } = value as Record<string, unknown>;
  return (
    REMINDER_KINDS.some((known) => known === kind) &&
    typeof planId === "string" &&
    (responseId === undefined || typeof responseId === "string") &&
    typeof dueAt === "string" &&
    !Number.isNaN(Date.parse(dueAt))
  );
}

/**
 * A carried subscription is checked like a new one: it must still point at a push service; a
 * carried address must still be one plain address.
 */
function isNotificationTarget(value: unknown): value is NotificationTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  if ("channelId" in target) return typeof target.channelId === "string";
  if ("email" in target) {
    const email = target.email as Record<string, unknown> | null;
    return (
      typeof email === "object" &&
      email !== null &&
      typeof email.address === "string" &&
      parseEmailAddress(email.address).ok
    );
  }
  return "subscription" in target && parsePushSubscription(target.subscription).ok;
}
