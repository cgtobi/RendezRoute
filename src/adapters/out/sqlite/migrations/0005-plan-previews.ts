import { type Kysely, sql } from "kysely";

// Cached link preview images (spec 3.10, decision D14): one per plan, public data only, deleted
// with the plan by the foreign key instead of a file path that could be left behind.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table plan_previews (
      plan_id text primary key not null references plans (id) on delete cascade,
      version text not null,
      image   blob not null
    ) strict
  `.execute(db);
}
