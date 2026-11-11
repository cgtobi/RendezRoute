// Fedify's KvStore on the app's SQLite file (spec 4: no other services; plan v1.0 step 9a). Keys
// are stored as their JSON text, so a prefix is the key's text without its closing bracket;
// values as JSON. A time to live becomes an expiry: expired values read as absent and are removed
// by housekeeping.
import type { KvKey, KvStore, KvStoreListEntry, KvStoreSetOptions } from "@fedify/fedify";
import type { Database } from "./database.ts";

export interface FedifyKvStore extends KvStore {
  /** Removes expired values for good; returns how many. */
  deleteExpired(): Promise<number>;
}

const keyText = (key: KvKey) => JSON.stringify(key);

export function createFedifyKvStore(database: Database, now: () => Date): FedifyKvStore {
  const { db } = database;
  const expiry = (options: KvStoreSetOptions | undefined) =>
    options?.ttl === undefined
      ? null
      : new Date(now().getTime() + options.ttl.total({ unit: "milliseconds" })).toISOString();
  const live = () => {
    const at = now().toISOString();
    return db
      .selectFrom("fedify_kv")
      .select(["key", "value"])
      .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", at)]));
  };
  const read = async (key: KvKey) =>
    (await live().where("key", "=", keyText(key)).executeTakeFirst())?.value;

  return {
    async get<T = unknown>(key: KvKey): Promise<T | undefined> {
      const value = await read(key);
      return value === undefined ? undefined : (JSON.parse(value) as T);
    },

    async set(key, value, options) {
      // Storing nothing is deleting (JSON has no undefined).
      if (value === undefined) return this.delete(key);
      await db
        .insertInto("fedify_kv")
        .values({ key: keyText(key), value: JSON.stringify(value), expires_at: expiry(options) })
        .onConflict((oc) =>
          oc.column("key").doUpdateSet({
            value: JSON.stringify(value),
            expires_at: expiry(options),
          }),
        )
        .execute();
    },

    async delete(key) {
      await db.deleteFrom("fedify_kv").where("key", "=", keyText(key)).execute();
    },

    // Atomic: Kysely holds the one connection for the transaction, so no other query runs between
    // the read and the write. Values are compared as JSON text, which is enough because Fedify
    // passes back the value it read; a new value of undefined deletes.
    async cas(key, expectedValue, newValue, options) {
      return db.transaction().execute(async (trx) => {
        const at = now().toISOString();
        const row = await trx
          .selectFrom("fedify_kv")
          .select("value")
          .where("key", "=", keyText(key))
          .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", at)]))
          .executeTakeFirst();
        const current = row === undefined ? undefined : (JSON.parse(row.value) as unknown);
        if (JSON.stringify(current) !== JSON.stringify(expectedValue)) return false;
        if (newValue === undefined) {
          await trx.deleteFrom("fedify_kv").where("key", "=", keyText(key)).execute();
          return true;
        }
        await trx
          .insertInto("fedify_kv")
          .values({
            key: keyText(key),
            value: JSON.stringify(newValue),
            expires_at: expiry(options),
          })
          .onConflict((oc) =>
            oc.column("key").doUpdateSet({
              value: JSON.stringify(newValue),
              expires_at: expiry(options),
            }),
          )
          .execute();
        return true;
      });
    },

    async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
      let query = live();
      if (prefix !== undefined) {
        const exact = keyText(prefix);
        // '["a"' + ',' matches ["a", ...] but not ["ab"]; the key itself matches exactly.
        const longer = `${exact.slice(0, -1)},`;
        query = query.where((eb) =>
          eb.or([
            eb("key", "=", exact),
            eb("key", ">=", longer).and("key", "<", `${longer}\uffff`),
          ]),
        );
      }
      for (const row of await query.orderBy("key").execute()) {
        yield { key: JSON.parse(row.key) as KvKey, value: JSON.parse(row.value) as unknown };
      }
    },

    async deleteExpired() {
      const result = await db
        .deleteFrom("fedify_kv")
        .where("expires_at", "<=", now().toISOString())
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}
