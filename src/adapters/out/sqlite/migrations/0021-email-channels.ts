import { type Kysely, sql } from "kysely";

// Email channels (plan v1.0 step 6, decision D31): the channel kind check gains 'email', channels
// may belong to an account (identity_id, spec 4; used by the account's own address from step 6b
// on), and the job types gain the confirmation link and report alerts. SQLite cannot change a
// check constraint, so both tables are rebuilt; nothing references them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table notification_channels_new (
      id          text primary key not null,
      response_id text references responses (id) on delete cascade,
      plan_id     text references plans (id) on delete cascade,
      identity_id text references identities (id) on delete cascade,
      kind        text not null check (kind in ('webpush', 'email')),
      config_enc  text not null,
      verified    integer not null default 0,
      created_at  text not null,
      device_id   text references devices (id) on delete cascade,
      check ((response_id is not null) + (plan_id is not null) + (identity_id is not null) = 1)
    ) strict
  `.execute(db);
  await sql`
    insert into notification_channels_new
      (id, response_id, plan_id, kind, config_enc, verified, created_at, device_id)
    select id, response_id, plan_id, kind, config_enc, verified, created_at, device_id
    from notification_channels
  `.execute(db);
  await sql`drop table notification_channels`.execute(db);
  await sql`alter table notification_channels_new rename to notification_channels`.execute(db);
  for (const column of ["response_id", "plan_id", "identity_id", "device_id"]) {
    const name = `notification_channels_${column.replace(/_id$/, "")}`;
    await sql`create index ${sql.id(name)} on notification_channels (${sql.id(column)})`.execute(
      db,
    );
  }

  await sql`
    create table job_queue_new (
      id          text primary key not null,
      type        text not null check (type in ('notification', 'emailConfirmation', 'reportAlert')),
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
