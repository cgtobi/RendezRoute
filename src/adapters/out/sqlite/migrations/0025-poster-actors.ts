import { type Kysely, sql } from "kysely";

// Poster actors (plan v1.0 step 9b, decisions D35, D36, D37). The plans table is rebuilt (SQLite
// cannot change a check otherwise; foreign keys are off while migrating) so that `followers` needs
// an account owner (spec 4), and gains `federated_at`: when the plan was saved under the fediverse
// wording, so only such plans are shared (D35). Fediverse profiles: one active per account, with
// its handle and signing keys (encrypted, D36); a retired one keeps only its actor identifier
// (answered as gone) and a keyed hash of its handle, so the handle is never taken again (D37).
export async function up(db: Kysely<unknown>): Promise<void> {
  // All or nothing: Kysely runs SQLite migrations outside a transaction, and a rebuild stopped
  // halfway would leave no view and two plans tables behind.
  await db.transaction().execute(rebuild);
}

async function rebuild(db: Kysely<unknown>): Promise<void> {
  // The view reads plans; SQLite checks views while renaming, so it is made again afterwards.
  await sql`drop view device_access`.execute(db);
  await sql`
    create table plans_new (
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
      ratings_closed_at        text,
      rating_tally             text,
      owner_identity_id        text references identities (id) on delete set null,
      federated_at             text,
      check ((area_lat is null) = (area_lng is null)),
      check ((pace_min_s_per_km is null) = (pace_max_s_per_km is null)),
      check (pace_min_s_per_km <= pace_max_s_per_km),
      check (visibility <> 'followers' or owner_identity_id is not null),
      check (retention_days >= case recap_window when '1w' then 7 when '1d' then 1 else 0 end)
    ) strict
  `.execute(db);
  await sql`
    insert into plans_new (
      id, slug, poster_name, poster_language, activity_type, title, note, starts_at, timezone,
      area_label, area_lat, area_lng, exact_location_enc, distance_m, elevation_gain_m,
      pace_min_s_per_km, pace_max_s_per_km, drop_policy, primary_color, secondary_color,
      visibility, join_mode, status, recap_window, recap_window_set_at, recap_closed_at,
      retention_days, delete_at, keep_as_template, template_include_private, host_token_hash,
      created_at, updated_at, ratings_closed_at, rating_tally, owner_identity_id, federated_at
    )
    select
      id, slug, poster_name, poster_language, activity_type, title, note, starts_at, timezone,
      area_label, area_lat, area_lng, exact_location_enc, distance_m, elevation_gain_m,
      pace_min_s_per_km, pace_max_s_per_km, drop_policy, primary_color, secondary_color,
      visibility, join_mode, status, recap_window, recap_window_set_at, recap_closed_at,
      retention_days, delete_at, keep_as_template, template_include_private, host_token_hash,
      created_at, updated_at, ratings_closed_at, rating_tally, owner_identity_id, null
    from plans
  `.execute(db);
  await sql`drop table plans`.execute(db);
  await sql`alter table plans_new rename to plans`.execute(db);
  await sql`create index plans_delete_at on plans (delete_at)`.execute(db);
  await sql`create index plans_starts_at on plans (starts_at)`.execute(db);
  await sql`create index plans_public_area on plans (visibility, area_lat, area_lng)`.execute(db);
  await sql`create index plans_owner_identity_id on plans (owner_identity_id)`.execute(db);
  // As in 0019.
  await sql`
    create view device_access as
      select device_id, role, plan_id, response_id, template_id, 'link' as source from device_links
      union all
      select devices.id, 'host', plans.id, null, null, 'account'
        from devices join plans on plans.owner_identity_id = devices.identity_id
      union all
      select devices.id, 'manage', null, responses.id, null, 'account'
        from devices join responses on responses.identity_id = devices.identity_id
      union all
      select devices.id, 'template', null, null, plan_templates.id, 'account'
        from devices join plan_templates on plan_templates.owner_identity_id = devices.identity_id
  `.execute(db);

  await sql`
    create table fediverse_profiles (
      id           text primary key not null,
      identity_id  text unique references identities (id) on delete set null,
      handle       text unique,
      handle_hmac  text not null unique,
      keys_enc     text,
      created_at   text not null,
      retired_at   text,
      check (
        (retired_at is null) =
        (identity_id is not null and handle is not null and keys_enc is not null)
      )
    ) strict
  `.execute(db);
}
