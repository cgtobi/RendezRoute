// Sent reminders in SQLite (decision I39): deleted with their plan or response by the foreign keys.
import type { SentReminder, SentReminderRepository } from "../../../application/ports.ts";
import type { Database } from "./database.ts";

export function createSentReminderRepository(database: Database): SentReminderRepository {
  const { db } = database;
  const row = (reminder: SentReminder) => ({
    plan_id: reminder.planId,
    response_id: reminder.responseId ?? null,
    kind: reminder.kind,
    due_at: reminder.dueAt.toISOString(),
  });

  return {
    async wasSent(reminder) {
      const { plan_id, response_id, kind, due_at } = row(reminder);
      const found = await db
        .selectFrom("sent_reminders")
        .select("kind")
        .where("plan_id", "=", plan_id)
        .where("response_id", response_id === null ? "is" : "=", response_id)
        .where("kind", "=", kind)
        .where("due_at", "=", due_at)
        .executeTakeFirst();
      return found !== undefined;
    },

    async record(reminder) {
      await db
        .insertInto("sent_reminders")
        .values(row(reminder))
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    },
  };
}
