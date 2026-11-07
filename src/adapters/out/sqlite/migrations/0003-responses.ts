import { type Kysely, sql } from "kysely";

// Spec section 4 `responses`, v0.1 subset: identity_id and remote actor columns arrive
// with accounts and federation in v1.0 (decision I23). Rebuilds device_links so it can
// link devices to responses (role 'manage').
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table responses (
      id                text primary key not null,
      plan_id           text not null references plans (id) on delete cascade,
      kind              text not null check (kind in ('interested', 'requested', 'rejected', 'joined', 'removed')),
      display_name_enc  text not null,
      request_note_enc  text,
      manage_token_hash text not null unique,
      -- Kept for blocks after rejection or removal (spec 3.5); survives device expiry as null.
      device_id         text references devices (id) on delete set null,
      language          text not null,
      previous_kind     text check (previous_kind in ('interested', 'requested', 'joined')),
      -- One-time value from the response form; detects double submits (decision I25).
      creation_nonce    text unique,
      created_at        text not null,
      updated_at        text not null
    ) strict
  `.execute(db);
  await sql`create index responses_plan_kind on responses (plan_id, kind)`.execute(db);
  await sql`create index responses_plan_device on responses (plan_id, device_id)`.execute(db);

  // SQLite cannot alter constraints: create, copy, drop, rename.
  await sql`
    create table device_links_new (
      device_id   text not null references devices (id) on delete cascade,
      role        text not null check (role in ('host', 'manage')),
      plan_id     text references plans (id) on delete cascade,
      response_id text references responses (id) on delete cascade,
      created_at  text not null,
      check ((plan_id is not null) + (response_id is not null) = 1),
      check ((role = 'host') = (plan_id is not null))
    ) strict
  `.execute(db);
  await sql`
    insert into device_links_new (device_id, role, plan_id, created_at)
    select device_id, role, plan_id, created_at from device_links
  `.execute(db);
  await sql`drop table device_links`.execute(db);
  await sql`alter table device_links_new rename to device_links`.execute(db);
  await sql`create unique index device_links_device_plan on device_links (device_id, plan_id) where plan_id is not null`.execute(
    db,
  );
  await sql`create unique index device_links_device_response on device_links (device_id, response_id) where response_id is not null`.execute(
    db,
  );
  await sql`create index device_links_plan_id on device_links (plan_id)`.execute(db);
  await sql`create index device_links_response_id on device_links (response_id)`.execute(db);
}
