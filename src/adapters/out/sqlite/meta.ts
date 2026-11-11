import type { Database } from "./database.ts";

/** key_fingerprint: the encryption key's check (3.11); telegram_offset: the next bot update (D34). */
export type MetaKey = "key_fingerprint" | "telegram_offset";

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
