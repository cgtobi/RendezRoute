import { type Kysely, sql } from "kysely";

// Spec section 4 `routes`. Only the geometry is stored (decision D10): no gpx_file_path,
// no file on disk; GPX downloads are regenerated from geojson_enc.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table routes (
      id          text primary key not null,
      plan_id     text not null unique references plans (id) on delete cascade,
      geojson_enc text not null
    ) strict
  `.execute(db);
}
