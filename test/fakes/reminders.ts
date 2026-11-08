import type { SentReminder, SentReminderRepository } from "../../src/application/ports.ts";

const key = (r: SentReminder) =>
  `${r.kind}|${r.planId}|${r.responseId ?? ""}|${r.dueAt.toISOString()}`;

/** In-memory sent reminders. */
export class FakeSentReminders implements SentReminderRepository {
  readonly sent = new Set<string>();

  wasSent(reminder: SentReminder) {
    return Promise.resolve(this.sent.has(key(reminder)));
  }

  record(reminder: SentReminder) {
    this.sent.add(key(reminder));
    return Promise.resolve();
  }
}
