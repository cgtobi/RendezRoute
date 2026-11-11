import { type Kysely, sql } from "kysely";

// Fedify's federation state (spec 4, plan v1.0 step 9a): its key-value store in the app's own
// file, no other service. Keys are JSON arrays of strings, values JSON; cached documents expire.
// Nothing references it; housekeeping removes expired rows.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table fedify_kv (
      key        text primary key not null,
      value      text not null,
      expires_at text
    ) strict
  `.execute(db);
  await sql`create index fedify_kv_expires_at on fedify_kv (expires_at)`.execute(db);
}
