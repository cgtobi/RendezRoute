import { type Kysely, sql } from "kysely";

// Followers of the instance's actors (0.9 step 10a, decision D38): one row per local actor (the
// instance actor or a poster's) and remote actor that follows it. The remote actor's address and
// inboxes are stored encrypted, found by a keyed hash of its address. The rows of a poster actor
// go when its profile is retired; nothing else references them. The job table is rebuilt for its
// type check, as in 0022, so activities can be delivered as jobs; nothing references it. All in
// one transaction, as Kysely runs SQLite migrations outside one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(migrate);
}

async function migrate(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table job_queue_new (
      id          text primary key not null,
      type        text not null check (
        type in ('notification', 'channelConfirmation', 'reportAlert', 'accountNotice',
                 'federationDelivery')
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

  await sql`
    create table fediverse_followers (
      id           text primary key not null,
      local_actor  text not null,
      remote_hmac  text not null,
      remote_enc   text not null,
      created_at   text not null,
      unique (local_actor, remote_hmac)
    ) strict
  `.execute(db);
  await sql`create index fediverse_followers_remote on fediverse_followers (remote_hmac)`.execute(
    db,
  );
}
