import { type Kysely, sql } from "kysely";

// Reports to the instance admin (spec 7 Moderation, decision I47): no reporter column, details and
// attached recap copies encrypted; deleted with the plan.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table reports (
      id                   text primary key not null,
      plan_id              text not null references plans (id) on delete cascade,
      reason               text not null check (reason in ('spam', 'inappropriate', 'unsafe', 'other')),
      details_enc          text,
      attached_content_enc text,
      created_at           text not null,
      resolved_at          text
    ) strict
  `.execute(db);
  await sql`create index reports_plan on reports (plan_id)`.execute(db);
  await sql`create index reports_open on reports (created_at) where resolved_at is null`.execute(
    db,
  );
}
