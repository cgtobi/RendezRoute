import { type Kysely, sql } from "kysely";

// One-time values of "Get a new link" forms (decision I44): a resent form shows a notice instead of
// replacing the link that was just shown. No personal data; deleted after a day by housekeeping.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table used_form_nonces (
      nonce   text primary key not null,
      used_at text not null
    ) strict
  `.execute(db);
  await sql`create index used_form_nonces_used_at on used_form_nonces (used_at)`.execute(db);
}
