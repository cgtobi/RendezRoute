import { type Kysely, sql } from "kysely";

// Personal calendar feeds (spec 6 feature 2, decision I40): one per device, found by the hash of
// its secret token, in the language of the browser that created it. Deleted with the device.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table calendar_feeds (
      id         text primary key,
      device_id  text not null unique references devices (id) on delete cascade,
      token_hash text not null unique,
      language   text not null,
      created_at text not null
    ) strict
  `.execute(db);
}
