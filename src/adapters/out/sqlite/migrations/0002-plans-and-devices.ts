import { type Kysely, sql } from "kysely";

// Spec section 4, v0.1 subset. Enum lists are literal (migrations are immutable);
// test/adapters/out/sqlite/schema-conformance.test.ts checks them against the domain.
// Deferred until their tables exist (SQLite rejects foreign keys to missing tables):
// plans.owner_identity_id (v1.0) and device_links for responses (step 4) and templates (v0.5).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table plans (
      id                       text primary key not null,
      slug                     text unique,
      poster_name              text not null,
      poster_language          text not null,
      activity_type            text not null check (activity_type in ('run', 'trail', 'ride', 'gravel', 'mtb')),
      title                    text not null,
      note                     text,
      starts_at                text not null,
      timezone                 text not null,
      area_label               text not null,
      area_lat                 real,
      area_lng                 real,
      exact_location_enc       text,
      distance_m               integer check (distance_m > 0),
      elevation_gain_m         integer check (elevation_gain_m >= 0),
      pace_min_s_per_km        integer,
      pace_max_s_per_km        integer,
      drop_policy              text not null check (drop_policy in ('no_drop', 'drop')),
      primary_color            text not null default '#2E5BFF'
                               check (primary_color glob '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
      secondary_color          text not null default '#FF7A45'
                               check (secondary_color glob '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
      visibility               text not null default 'link' check (visibility in ('link', 'followers', 'public')),
      join_mode                text not null default 'open' check (join_mode in ('open', 'approval')),
      status                   text not null default 'active' check (status in ('active', 'cancelled')),
      recap_window             text not null check (recap_window in ('now', '1d', '1w')),
      recap_window_set_at      text,
      recap_closed_at          text,
      retention_days           integer not null check (retention_days between 1 and 30),
      delete_at                text not null,
      keep_as_template         integer not null default 0 check (keep_as_template in (0, 1)),
      template_include_private integer not null default 0 check (template_include_private in (0, 1)),
      host_token_hash          text not null unique,
      created_at               text not null,
      updated_at               text not null,
      check ((area_lat is null) = (area_lng is null)),
      check ((pace_min_s_per_km is null) = (pace_max_s_per_km is null)),
      check (pace_min_s_per_km <= pace_max_s_per_km),
      -- followers needs a logged-in owner (spec 4); accounts arrive in v1.0.
      check (visibility <> 'followers'),
      check (retention_days >= case recap_window when '1w' then 7 when '1d' then 1 else 0 end)
    ) strict
  `.execute(db);
  await sql`create index plans_delete_at on plans (delete_at)`.execute(db);
  await sql`create index plans_starts_at on plans (starts_at)`.execute(db);
  await sql`create index plans_public_area on plans (visibility, area_lat, area_lng)`.execute(db);

  await sql`
    create table devices (
      id           text primary key not null,
      token_hash   text not null unique,
      created_at   text not null,
      last_seen_at text not null
    ) strict
  `.execute(db);
  await sql`create index devices_last_seen_at on devices (last_seen_at)`.execute(db);

  await sql`
    create table device_links (
      device_id  text not null references devices (id) on delete cascade,
      role       text not null check (role in ('host')),
      plan_id    text not null references plans (id) on delete cascade,
      created_at text not null,
      primary key (device_id, plan_id)
    ) strict
  `.execute(db);
  await sql`create index device_links_plan_id on device_links (plan_id)`.execute(db);

  // Decision I9: detects a resubmitted create form. Deleted with its plan.
  await sql`
    create table plan_creation_nonces (
      nonce      text primary key not null,
      plan_id    text not null references plans (id) on delete cascade,
      created_at text not null
    ) strict
  `.execute(db);
  await sql`create index plan_creation_nonces_plan_id on plan_creation_nonces (plan_id)`.execute(
    db,
  );
}
