import { type Kysely, sql } from "kysely";

// Notification channels (spec 4, 6 feature 3): one row per browser push subscription, owned by a
// response or by the host of a plan, deleted with either. Account channels (v1.0) add a column.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table notification_channels (
      id          text primary key not null,
      response_id text references responses (id) on delete cascade,
      plan_id     text references plans (id) on delete cascade,
      kind        text not null check (kind in ('webpush')),
      config_enc  text not null,
      verified    integer not null default 0,
      created_at  text not null,
      check ((response_id is null) <> (plan_id is null))
    ) strict
  `.execute(db);
  await sql`create index notification_channels_response on notification_channels (response_id)`.execute(
    db,
  );
  await sql`create index notification_channels_plan on notification_channels (plan_id)`.execute(db);
}
