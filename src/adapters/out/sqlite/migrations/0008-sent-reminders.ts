import { type Kysely, sql } from "kysely";

// Reminders already sent (spec 6 feature 3, 3.10, decision I39): one row per reminder and the
// moment it was due, so a moved start or deletion date gives a new reminder. Plan-wide reminders
// have no response. Deleted with their plan or response.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table sent_reminders (
      plan_id     text not null references plans (id) on delete cascade,
      response_id text references responses (id) on delete cascade,
      kind        text not null check (kind in ('dayBefore', 'deletionReminder')),
      due_at      text not null
    ) strict
  `.execute(db);
  await sql`
    create unique index sent_reminders_unique
    on sent_reminders (plan_id, ifnull(response_id, ''), kind, due_at)
  `.execute(db);
  await sql`create index sent_reminders_response on sent_reminders (response_id)`.execute(db);
}
