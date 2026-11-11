import { type Kysely, sql } from "kysely";

// Account notices (plan v1.0 step 6b, decisions D31, I52): when an account was last warned that it
// will be deleted unused, so each stretch of non-use gets one warning; and the job type that sends
// such notices to the account's own channels. The job table is rebuilt for its type check, as in
// 0021; nothing references it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table identities add column expiry_warned_at text`.execute(db);
  await sql`
    create table job_queue_new (
      id          text primary key not null,
      type        text not null check (
        type in ('notification', 'emailConfirmation', 'reportAlert', 'accountNotice')
      ),
      payload_enc text not null,
      plan_id     text references plans (id) on delete cascade,
      response_id text references responses (id) on delete cascade,
      run_at      text not null,
      expires_at  text,
      attempts    integer not null default 0,
      last_error  text
    ) strict
  `.execute(db);
  await sql`insert into job_queue_new select * from job_queue`.execute(db);
  await sql`drop table job_queue`.execute(db);
  await sql`alter table job_queue_new rename to job_queue`.execute(db);
  await sql`create index job_queue_run_at on job_queue (run_at)`.execute(db);
  await sql`create index job_queue_plan on job_queue (plan_id)`.execute(db);
  await sql`create index job_queue_response on job_queue (response_id)`.execute(db);
}
