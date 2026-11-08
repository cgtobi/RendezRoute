import { type Kysely, sql } from "kysely";

// Background jobs (spec 4 job_queue, 6 feature 12). Payloads are encrypted; jobs tied to a plan
// or response are deleted with it, so only standalone deletion notices outlive them (spec 3.10).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table job_queue (
      id          text primary key not null,
      type        text not null check (type in ('notification')),
      payload_enc text not null,
      plan_id     text references plans (id) on delete cascade,
      response_id text references responses (id) on delete cascade,
      run_at      text not null,
      expires_at  text,
      attempts    integer not null default 0,
      last_error  text
    ) strict
  `.execute(db);
  await sql`create index job_queue_run_at on job_queue (run_at)`.execute(db);
  await sql`create index job_queue_plan on job_queue (plan_id)`.execute(db);
  await sql`create index job_queue_response on job_queue (response_id)`.execute(db);
}
