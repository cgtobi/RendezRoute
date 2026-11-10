import { type Kysely, sql } from "kysely";

// Invite links and posting permissions (spec 4, 7 Moderation; plan v1.0 step 3). Only token hashes
// are stored. A permission goes with its device and outlives its invite. The identity_id column and
// its check follow with accounts (step 4), which rebuild this table.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table invites (
      id         text primary key not null,
      token_hash text not null unique,
      expires_at text,
      max_uses   integer check (max_uses is null or max_uses > 0),
      uses       integer not null default 0 check (uses >= 0),
      revoked_at text,
      created_at text not null
    ) strict
  `.execute(db);
  await sql`
    create table permissions (
      id         text primary key not null,
      device_id  text not null references devices (id) on delete cascade,
      permission text not null check (permission in ('may_post')),
      invite_id  text references invites (id) on delete set null,
      created_at text not null,
      unique (device_id, permission)
    ) strict
  `.execute(db);
  await sql`create index permissions_invite on permissions (invite_id)`.execute(db);
}
