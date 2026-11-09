import { type Kysely, sql } from "kysely";

// Plan ratings (spec 6a, decision D20): one per participant's response, the note encrypted;
// deleted with the plan or the response. Plans remember when ratings were frozen by a reopened
// recap.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table plan_ratings (
      id          text primary key not null,
      plan_id     text not null references plans (id) on delete cascade,
      response_id text not null unique references responses (id) on delete cascade,
      value       text not null check (value in ('up', 'down')),
      note_enc    text,
      created_at  text not null,
      updated_at  text not null
    ) strict
  `.execute(db);
  await sql`create index plan_ratings_plan on plan_ratings (plan_id)`.execute(db);
  await sql`alter table plans add column ratings_closed_at text`.execute(db);
}
