import { type Kysely, sql } from "kysely";

// The account a calendar feed's device was logged in to when the feed was made (security review):
// the feed lists the account's plans only while the device is still logged in to that account, so
// logging in later on a borrowed browser does not put the account's plans into an older feed
// (decision D25). Null for feeds made while logged out, and for feeds that existed before this
// column: those are treated as device-only, the safe reading. Deleting the account clears it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table calendar_feeds
    add column identity_id text references identities (id) on delete set null
  `.execute(db);
}
