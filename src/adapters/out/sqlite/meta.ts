import type { Database } from "./database.ts";

export type MetaKey = "key_fingerprint";

export async function readMeta(database: Database, key: MetaKey): Promise<string | undefined> {
  const row = await database.db
    .selectFrom("instance_meta")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  return row?.value;
}

export async function writeMeta(database: Database, key: MetaKey, value: string): Promise<void> {
  await database.db
    .insertInto("instance_meta")
    .values({ key, value })
    .onConflict((conflict) => conflict.column("key").doUpdateSet({ value }))
    .execute();
}
