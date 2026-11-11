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
  // The day-before reminder for someone who joined after midnight (decision I39).
  "startsToday",
  "deletionReminder",
  "recapDeleted",
  // To the host (one switch per hosted plan, D17).
  "newResponse",
  "newRequest",
  "withdrawn",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** When and where, as anyone with the plan's link sees them (spec 3.6): never the exact start. */
export interface NotificationFacts {
  /** ISO 8601. */
  startsAt: string;
  timeZone: string;
  /** The public area label. */
  area: string;
}

/** For account notices: an account has no language of its own, its address usually has one. */
export const DEFAULT_NOTICE_LANGUAGE = "en";

export interface Notification {
  kind: NotificationKind;
  planTitle: string;
  /** Shown in emails (design note "Emails"); push shows only title and sentence. */
  facts?: NotificationFacts | undefined;
  /** Opened when the notification is tapped; absent once the plan is gone. */
  planPath?: string | undefined;
  /** The recipient's stored language (decision P7). */
  language: string;
}

export function isNotification(value: unknown): value is Notification {
  if (typeof value !== "object" || value === null) return false;
  const { kind, planTitle, planPath, language, facts } = value as Record<string, unknown>;
  return (
    NOTIFICATION_KINDS.some((known) => known === kind) &&
    typeof planTitle === "string" &&
    (facts === undefined || isFacts(facts)) &&
    (planPath === undefined || typeof planPath === "string") &&
    typeof language === "string"
  );
}

function isFacts(value: unknown): value is NotificationFacts {
  if (typeof value !== "object" || value === null) return false;
  const { startsAt, timeZone, area } = value as Record<string, unknown>;
  return (
    typeof startsAt === "string" &&
    !Number.isNaN(Date.parse(startsAt)) &&
    typeof timeZone === "string" &&
    typeof area === "string"
  );
}
