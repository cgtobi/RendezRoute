// Notifications as jobs (spec 6 features 3 and 12): one job per channel, delivered by the
// Notifier with retries; a channel that is gone is reported so it can be removed.
import { isNotification, type Notification } from "../domain/notification.ts";
import type { JobOutcome } from "./jobs.ts";
import type { Clock, JobQueue, Notifier } from "./ports.ts";

interface NotificationJob {
  channelId: string;
  notification: Notification;
}

export function enqueueNotification(
  deps: { jobs: JobQueue; clock: Clock },
  request: {
    channelId: string;
    notification: Notification;
    /** Ties the job to its plan or response, so deleting them removes it (spec 3.10). */
    planId?: string | undefined;
    responseId?: string | undefined;
    runAt?: Date | undefined;
    expiresAt?: Date | undefined;
  },
): Promise<string> {
  const payload: NotificationJob = {
    channelId: request.channelId,
    notification: request.notification,
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
}): (payload: unknown) => Promise<JobOutcome> {
  return async (payload) => {
    if (!isNotificationJob(payload)) return "drop";
    const result = await deps.notifier.send(payload.channelId, payload.notification);
    if (result === "sent") return "done";
    if (result === "retry") return "retry";
    await deps.onGone?.(payload.channelId);
    return "drop";
  };
}

function isNotificationJob(value: unknown): value is NotificationJob {
  if (typeof value !== "object" || value === null) return false;
  const { channelId, notification } = value as Record<string, unknown>;
  return typeof channelId === "string" && isNotification(notification);
}
