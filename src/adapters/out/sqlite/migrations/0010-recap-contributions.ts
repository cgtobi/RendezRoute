import { type Kysely, sql } from "kysely";

// Recap contributions (spec 4, 6 feature 5, decision I42): comments and links of participants and
// the host (no response), encrypted, deleted with their plan or response.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table recap_contributions (
      id               text primary key,
      plan_id          text not null references plans (id) on delete cascade,
      response_id      text references responses (id) on delete cascade,
      body_enc         text,
      link_url_enc     text,
      hidden_by_poster integer not null default 0 check (hidden_by_poster in (0, 1)),
      created_at       text not null,
      updated_at       text not null,
      check (body_enc is not null or link_url_enc is not null)
    ) strict
  `.execute(db);
  await sql`create index recap_contributions_plan on recap_contributions (plan_id, created_at)`.execute(
    db,
  );
  await sql`create index recap_contributions_response on recap_contributions (response_id)`.execute(
    db,
  );
}
