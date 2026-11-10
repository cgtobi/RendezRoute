import { type Kysely, sql } from "kysely";

// Fediverse accounts (decisions D23, D24): the handle as shown (@name@host), encrypted and updated
// at each login, next to the stable subject (server and account ID) it is found by. Keeping the
// subject itself encrypted lets a key rotation rehash the lookup (spec 3.11).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table identities add column handle_enc text`.execute(db);
}
