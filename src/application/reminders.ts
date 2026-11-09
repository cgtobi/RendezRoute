// Day-before and deletion reminders (spec 6 feature 3, 3.10, decisions I39, I42), sent by a sweep
// every minute. Each reminder is remembered per recipient with what it is about: the day-before
// moment, or the deletion date. So a moved start or deletion date gives a new one, a changed recap
// window does not, and people who join or turn notifications on later still get it. A queued
// reminder is checked again before it is sent.
import type { NotificationKind } from "../domain/notification.ts";
import type { Plan } from "../domain/plan.ts";
import {
  dayBeforeReminderAt,
  dayBeforeReminderDue,
  deletionReminderDue,
  type ReminderKind,
  reminderWindows,
  startsToday,
} from "../domain/reminders.ts";
import type { ResponseKind } from "../domain/response.ts";
import { hostOf, notify, type Recipient, responderOf, responsesStillIn } from "./notify.ts";
import type { PlanDeps } from "./plans.ts";
import type { SentReminder } from "./ports.ts";

/** Who gets each reminder besides the host: the deletion reminder also goes to the host. */
const RECIPIENTS: Record<ReminderKind, ReadonlySet<ResponseKind>> = {
  dayBefore: new Set(["joined", "interested"]),
  deletionReminder: new Set(["joined"]),
};

/**
 * Queues the reminders due now; returns how many recipients got one. A plan that fails does not
 * hold up the others; the first failure is thrown at the end, so it is logged.
 */
export async function runReminders(
  deps: PlanDeps,
): Promise<{ dayBefore: number; deletion: number }> {
  const now = deps.clock.now();
  const { startsBetween, deletesBetween } = reminderWindows(now);
  const failures: unknown[] = [];
  const forEach = async (plans: Plan[], send: (plan: Plan) => Promise<number>) => {
    let sent = 0;
    for (const plan of plans) {
      try {
        sent += await send(plan);
      } catch (error) {
        failures.push(error);
      }
    }
    return sent;
  };
  const dayBefore = await forEach(
    await deps.plans.findActiveStartingBetween(...startsBetween),
    (plan) => sendDayBefore(deps, plan, now),
  );
  const deletion = await forEach(
    await deps.plans.findActiveDeletingBetween(...deletesBetween),
    (plan) => sendDeletionReminder(deps, plan, now),
  );
  if (failures.length > 0) throw failures[0];
  return { dayBefore, deletion };
}

/** To participants and interested people; until 3 hours before the start. */
async function sendDayBefore(deps: PlanDeps, plan: Plan, now: Date): Promise<number> {
  const dueAt = dayBeforeReminderDue(plan, now);
  if (dueAt === undefined) return 0;
  const recipients = await responsesStillIn(deps, plan, RECIPIENTS.dayBefore);
  return remind(deps, plan, recipients.map(responderOf), {
    reminder: { kind: "dayBefore", dueAt },
    // Someone who joins after midnight is told "today" (decision I39).
    notice: startsToday(plan, now) ? "startsToday" : "dayBefore",
    // Useless once the plan has started.
    expiresAt: plan.startsAt,
  });
}

/** To the host and participants (spec 3.10). */
async function sendDeletionReminder(deps: PlanDeps, plan: Plan, now: Date): Promise<number> {
  if (deletionReminderDue(plan, now) === undefined) return 0;
  const participants = await responsesStillIn(deps, plan, RECIPIENTS.deletionReminder);
  return remind(deps, plan, [hostOf(plan), ...participants.map(responderOf)], {
    // Once per deletion date: a recap window changed later moves the moment, not the date.
    reminder: { kind: "deletionReminder", dueAt: plan.deleteAt },
    notice: "deletionReminder",
    expiresAt: plan.deleteAt,
  });
}

/**
 * Sends the reminder to each recipient who has not had it and has notifications on; someone
 * without is not marked, so turning notifications on later still brings it.
 */
async function remind(
  deps: PlanDeps,
  plan: Plan,
  recipients: Recipient[],
  {
    reminder,
    notice,
    expiresAt,
  }: {
    reminder: Pick<SentReminder, "kind" | "dueAt">;
    notice: NotificationKind;
    expiresAt: Date;
  },
): Promise<number> {
  if (deps.notify === undefined) return 0;
  let sent = 0;
  for (const recipient of recipients) {
    const { owner } = recipient;
    const once: SentReminder = {
      ...reminder,
      planId: plan.id,
      responseId: "responseId" in owner ? owner.responseId : undefined,
    };
    if (await deps.notify.reminders.wasSent(once)) continue;
    if ((await deps.notify.channels.listFor(owner)).length === 0) continue;
    // Marked first: a crash before queueing loses this reminder rather than sending it twice.
    await deps.notify.reminders.record(once);
    await notify(deps, plan, recipient, notice, { expiresAt, reminder: once });
    sent += 1;
  }
  return sent;
}

/**
 * Whether a queued reminder should still go out: its plan is active, its day-before moment or
 * deletion date is unchanged and its recipient is still among the people it is for (spec 3.5: nothing after removal).
 */
export async function reminderStillDue(deps: PlanDeps, reminder: SentReminder): Promise<boolean> {
  const plan = await deps.plans.findById(reminder.planId);
  if (plan === undefined || plan.status !== "active") return false;
  const dueAt = reminder.kind === "dayBefore" ? dayBeforeReminderAt(plan) : plan.deleteAt;
  if (dueAt?.getTime() !== reminder.dueAt.getTime()) return false;
  if (reminder.responseId === undefined) return true; // the host
  const response = await deps.responses.findById(reminder.responseId);
  return response !== undefined && RECIPIENTS[reminder.kind].has(response.kind);
}
