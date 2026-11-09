import { type Kysely, sql } from "kysely";

// Repeatable templates (spec 4, 3.10 Templates, decision I43): a plan's base data, the exact start
// and route only on opt-in (encrypted). Rebuilds device_links so devices can be linked to them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table plan_templates (
      id                 text primary key not null,
      -- Null for templates made at deletion until "Get a new link" issues one (decision I36).
      host_token_hash    text unique,
      poster_name        text not null,
      poster_language    text not null,
      timezone           text not null,
      start_time         text not null check (start_time glob '[0-2][0-9]:[0-5][0-9]'),
      activity_type      text not null check (activity_type in ('run', 'trail', 'ride', 'gravel', 'mtb')),
      title              text not null,
      note               text,
      area_label         text not null,
      area_lat           real,
      area_lng           real,
      exact_location_enc text,
      distance_m         integer check (distance_m > 0),
      elevation_gain_m   integer check (elevation_gain_m >= 0),
      pace_min_s_per_km  integer,
      pace_max_s_per_km  integer,
      drop_policy        text not null check (drop_policy in ('no_drop', 'drop')),
      primary_color      text not null
                         check (primary_color glob '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
      secondary_color    text not null
                         check (secondary_color glob '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
      visibility         text not null check (visibility in ('link', 'followers', 'public')),
      join_mode          text not null check (join_mode in ('open', 'approval')),
      recap_window       text not null check (recap_window in ('now', '1d', '1w')),
      retention_days     integer not null check (retention_days between 1 and 30),
      route_geojson_enc  text,
      -- One-time value from the "Save as template" form; detects resubmission (decision I9).
      creation_nonce     text unique,
      last_used_at       text not null,
      expires_at         text not null,
      created_at         text not null,
      updated_at         text not null,
      check ((area_lat is null) = (area_lng is null)),
      check ((pace_min_s_per_km is null) = (pace_max_s_per_km is null)),
      check (pace_min_s_per_km <= pace_max_s_per_km),
      check (retention_days >= case recap_window when '1w' then 7 when '1d' then 1 else 0 end)
    ) strict
  `.execute(db);
  await sql`create index plan_templates_expires_at on plan_templates (expires_at)`.execute(db);

  // SQLite cannot alter constraints: create, copy, drop, rename (as in 0003).
  await sql`
    create table device_links_new (
      device_id   text not null references devices (id) on delete cascade,
      role        text not null check (role in ('host', 'manage', 'template')),
      plan_id     text references plans (id) on delete cascade,
      response_id text references responses (id) on delete cascade,
      template_id text references plan_templates (id) on delete cascade,
      created_at  text not null,
      check ((plan_id is not null) + (response_id is not null) + (template_id is not null) = 1),
      check ((role = 'host') = (plan_id is not null)),
      check ((role = 'manage') = (response_id is not null))
    ) strict
  `.execute(db);
  await sql`
    insert into device_links_new (device_id, role, plan_id, response_id, created_at)
    select device_id, role, plan_id, response_id, created_at from device_links
  `.execute(db);
  await sql`drop table device_links`.execute(db);
  await sql`alter table device_links_new rename to device_links`.execute(db);
  await sql`create unique index device_links_device_plan on device_links (device_id, plan_id) where plan_id is not null`.execute(
    db,
  );
  await sql`create unique index device_links_device_response on device_links (device_id, response_id) where response_id is not null`.execute(
    db,
  );
  await sql`create unique index device_links_device_template on device_links (device_id, template_id) where template_id is not null`.execute(
    db,
  );
  await sql`create index device_links_plan_id on device_links (plan_id)`.execute(db);
  await sql`create index device_links_response_id on device_links (response_id)`.execute(db);
  await sql`create index device_links_template_id on device_links (template_id)`.execute(db);
}
