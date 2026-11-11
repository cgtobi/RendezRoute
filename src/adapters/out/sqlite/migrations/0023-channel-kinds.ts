import { type Kysely, sql } from "kysely";

// More channel kinds (plan v1.0 step 7, decision D33): the kind check gains every kind spec 4
// names, ntfy now and Telegram and fediverse direct messages later, so no further rebuild is
// needed; the confirmation job serves every confirmable channel and is renamed. Both tables are
// rebuilt, as in 0021; nothing references them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table notification_channels_new (
      id          text primary key not null,
      response_id text references responses (id) on delete cascade,
      plan_id     text references plans (id) on delete cascade,
      identity_id text references identities (id) on delete cascade,
      kind        text not null check (
        kind in ('webpush', 'email', 'ntfy', 'telegram', 'fediverse_dm')
      ),
      config_enc  text not null,
      verified    integer not null default 0,
      created_at  text not null,
      device_id   text references devices (id) on delete cascade,
      check ((response_id is not null) + (plan_id is not null) + (identity_id is not null) = 1)
    ) strict
  `.execute(db);
  await sql`insert into notification_channels_new select * from notification_channels`.execute(db);
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
      type        text not null check (
        type in ('notification', 'channelConfirmation', 'reportAlert', 'accountNotice')
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
  await sql`
    insert into job_queue_new
    select id,
           case type when 'emailConfirmation' then 'channelConfirmation' else type end,
           payload_enc, plan_id, response_id, run_at, expires_at, attempts, last_error
    from job_queue
  `.execute(db);
  await sql`drop table job_queue`.execute(db);
  await sql`alter table job_queue_new rename to job_queue`.execute(db);
  await sql`create index job_queue_run_at on job_queue (run_at)`.execute(db);
  await sql`create index job_queue_plan on job_queue (plan_id)`.execute(db);
  await sql`create index job_queue_response on job_queue (response_id)`.execute(db);
}
