import { type Kysely, sql } from "kysely";

// Accounts (spec 4 identities, 7 Identity; plan v1.0 step 4a). The subject is encrypted and found by
// a keyed hash; the device is linked to the account (no second cookie); pending logins keep their
// one-time values encrypted for at most ten minutes. Permissions gain the account column and the
// either-or check that step 3 left out (decision I48), by rebuilding the table.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table identities (
      id               text primary key not null,
      provider         text not null check (provider in ('oidc', 'fediverse')),
      subject_hmac     text not null,
      subject_enc      text not null,
      display_name_enc text,
      created_at       text not null,
      last_active_at   text not null,
      unique (provider, subject_hmac)
    ) strict
  `.execute(db);
  await sql`create index identities_last_active on identities (last_active_at)`.execute(db);

  await sql`
    alter table devices add column identity_id text references identities (id) on delete set null
  `.execute(db);
  await sql`create index devices_identity on devices (identity_id)`.execute(db);

  await sql`
    create table pending_logins (
      state_hash  text primary key not null,
      provider    text not null check (provider in ('oidc', 'fediverse')),
      secrets_enc text not null,
      started_at  text not null
    ) strict
  `.execute(db);
  await sql`create index pending_logins_started on pending_logins (started_at)`.execute(db);

  await sql`
    create table permissions_new (
      id          text primary key not null,
      device_id   text references devices (id) on delete cascade,
      identity_id text references identities (id) on delete cascade,
      permission  text not null check (permission in ('may_post')),
      invite_id   text references invites (id) on delete set null,
      created_at  text not null,
      check ((device_id is null) <> (identity_id is null)),
      unique (device_id, permission),
      unique (identity_id, permission)
    ) strict
  `.execute(db);
  await sql`
    insert into permissions_new (id, device_id, permission, invite_id, created_at)
    select id, device_id, permission, invite_id, created_at from permissions
  `.execute(db);
  await sql`drop table permissions`.execute(db);
  await sql`alter table permissions_new rename to permissions`.execute(db);
  await sql`create index permissions_invite on permissions (invite_id)`.execute(db);
  await sql`create index permissions_identity on permissions (identity_id)`.execute(db);
}
