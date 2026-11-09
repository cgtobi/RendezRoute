import { type Kysely, sql } from "kysely";

// The host's rating counts, stored when something first changes them after the close (spec 6a,
// decision D20): JSON { participants, rated, up, down }, totals only, never anyone's rating.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table plans add column rating_tally text`.execute(db);
}
