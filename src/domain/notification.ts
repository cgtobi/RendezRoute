// What people can be notified about (spec 6 features 3, 7, 11; decision D17). A notification
// carries only what its recipient may see: never the exact start, a route or other people's names.

export const NOTIFICATION_KINDS = [
  // To people who responded (one switch per response, D17).
  "accepted",
  "rejected",
  "removed",
  "changed",
  "cancelled",
  "deleted",
  "dayBefore",
  "deletionReminder",
  "recapDeleted",
  // To the host (one switch per hosted plan, D17).
  "newResponse",
  "newRequest",
  "withdrawn",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface Notification {
  kind: NotificationKind;
  planTitle: string;
  /** Opened when the notification is tapped; absent once the plan is gone. */
  planPath?: string | undefined;
  /** The recipient's stored language (decision P7). */
  language: string;
}

export function isNotification(value: unknown): value is Notification {
  if (typeof value !== "object" || value === null) return false;
  const { kind, planTitle, planPath, language } = value as Record<string, unknown>;
  return (
    NOTIFICATION_KINDS.some((known) => known === kind) &&
    typeof planTitle === "string" &&
    (planPath === undefined || typeof planPath === "string") &&
    typeof language === "string"
  );
}
