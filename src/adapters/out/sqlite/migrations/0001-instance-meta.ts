import { type Kysely, sql } from "kysely";

// Migrations are immutable once released: never edit, always add a new one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table instance_meta (
      key   text primary key not null,
      value text not null
    ) strict
  `.execute(db);
}
