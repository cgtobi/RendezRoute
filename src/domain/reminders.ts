// When reminders are due (spec 6 feature 3, 3.10, decision I39). Each reminder belongs to the
// moment it was due, so moving the start or the deletion date gives a new one.
import type { PlanStatus } from "./plan.ts";
import { type RecapTiming, recapClosesAt } from "./recap.ts";
import { instantToLocal, localToInstant } from "./timezone.ts";

export const REMINDER_KINDS = ["dayBefore", "deletionReminder"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Local time of the day-before reminder. */
const DAY_BEFORE_TIME = "18:00";
/** No day-before reminder when the start is closer than this. */
const DAY_BEFORE_MIN_LEAD_MS = 3 * HOUR_MS;
/** 18:00 the day before is at most 30 hours before a start, 31 across a daylight saving change. */
const DAY_BEFORE_MAX_LEAD_MS = 31 * HOUR_MS;
/** The deletion reminder comes this long before deletion, or at the recap close if later. */
const DELETION_REMINDER_LEAD_MS = 2 * DAY_MS;
/** No deletion reminder closer to deletion than this. */
const DELETION_REMINDER_MIN_LEAD_MS = 6 * HOUR_MS;

interface Timing {
  startsAt: Date;
  timeZone: string;
  status: PlanStatus;
}

interface Retention extends RecapTiming {
  status: PlanStatus;
}

/** 18:00 in the plan's zone on the calendar day before the start; undefined if there is none. */
export function dayBeforeReminderAt({
  startsAt,
  timeZone,
}: Omit<Timing, "status">): Date | undefined {
  const { date } = instantToLocal(startsAt, timeZone);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const previous = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  const moment = localToInstant(previous, DAY_BEFORE_TIME, timeZone);
  return moment.ok ? moment.value : undefined;
}

/** The moment of the day-before reminder if it is due now, else undefined. */
export function dayBeforeReminderDue(plan: Timing, now: Date): Date | undefined {
  if (plan.status !== "active") return undefined;
  if (plan.startsAt.getTime() - now.getTime() < DAY_BEFORE_MIN_LEAD_MS) return undefined;
  const moment = dayBeforeReminderAt(plan);
  return moment !== undefined && now >= moment ? moment : undefined;
}

/** Whether the start is on today's date in the plan's zone, for "today" instead of "tomorrow". */
export function startsToday({ startsAt, timeZone }: Omit<Timing, "status">, now: Date): boolean {
  return instantToLocal(now, timeZone).date === instantToLocal(startsAt, timeZone).date;
}

/** The later of two days before deletion and the recap close (spec 3.10). */
export function deletionReminderAt(plan: Omit<Retention, "status">): Date {
  const twoDaysBefore = plan.deleteAt.getTime() - DELETION_REMINDER_LEAD_MS;
  return new Date(Math.max(twoDaysBefore, recapClosesAt(plan).getTime()));
}

/**
 * The moment of the deletion reminder if it is due now, else undefined: skipped when that moment,
 * or now, is less than 6 hours before deletion, and for cancelled plans.
 */
export function deletionReminderDue(plan: Retention, now: Date): Date | undefined {
  if (plan.status !== "active") return undefined;
  const moment = deletionReminderAt(plan);
  const latest = plan.deleteAt.getTime() - DELETION_REMINDER_MIN_LEAD_MS;
  if (moment.getTime() > latest || now.getTime() > latest) return undefined;
  return now >= moment ? moment : undefined;
}

/**
 * Start and deletion ranges that contain every plan with a reminder due now, for the queries that
 * find them; the rules above decide which reminders are due.
 */
export function reminderWindows(now: Date): {
  startsBetween: [Date, Date];
  deletesBetween: [Date, Date];
} {
  const at = (ms: number) => new Date(now.getTime() + ms);
  return {
    startsBetween: [at(DAY_BEFORE_MIN_LEAD_MS), at(DAY_BEFORE_MAX_LEAD_MS)],
    deletesBetween: [at(DELETION_REMINDER_MIN_LEAD_MS), at(DELETION_REMINDER_LEAD_MS)],
  };
}
