import { type Kysely, sql } from "kysely";

// Plans in the fediverse (0.9 step 10b, decisions D38, D39): which local actor sent a plan to
// which audience, so edits send `Update` and deletion or narrowing sends `Delete` to the same
// audience; once withdrawn, the plan is never sent again. Goes with its plan.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table plan_publications (
      plan_id       text primary key not null references plans (id) on delete cascade,
      local_actor   text,
      audience      text check (audience in ('followers', 'public')),
      published_at  text not null,
      withdrawn_at  text,
      check ((withdrawn_at is null) = (local_actor is not null and audience is not null))
    ) strict
  `.execute(db);
  await sql`create index plan_publications_actor on plan_publications (local_actor)`.execute(db);
}
