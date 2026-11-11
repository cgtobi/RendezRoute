// Fedify's federation state in the app's own SQLite file (spec 4, plan v1.0 step 9a): keys are
// arrays of strings, values JSON, optionally expiring.
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createFedifyKvStore } from "../../../../src/adapters/out/sqlite/fedify-kv.ts";
import { FakeClock } from "../../../fakes/clock.ts";

let database: Database;
let clock: FakeClock;
beforeEach(async () => {
  database = await openDatabase(":memory:");
  clock = new FakeClock(new Date("2026-06-01T08:00:00Z"));
});
afterEach(async () => {
  await database.close();
});

const store = () => createFedifyKvStore(database, () => clock.now());
const all = async (prefix?: readonly [string, ...string[]]) => {
  const entries: { key: readonly string[]; value: unknown }[] = [];
  for await (const entry of store().list(prefix)) entries.push(entry);
  return entries;
};

describe("Fedify's KV store on SQLite", () => {
  it("keeps JSON values under array keys, replaces and deletes them", async () => {
    const kv = store();
    expect(await kv.get(["a", "b"])).toBeUndefined();
    await kv.set(["a", "b"], { n: 1, list: ["x"] });
    expect(await kv.get(["a", "b"])).toEqual({ n: 1, list: ["x"] });
    await kv.set(["a", "b"], "second");
    expect(await kv.get(["a", "b"])).toBe("second");
    await kv.delete(["a", "b"]);
    expect(await kv.get(["a", "b"])).toBeUndefined();
  });

  it("forgets a value after its time to live", async () => {
    const kv = store();
    await kv.set(["cache", "doc"], 1, { ttl: Temporal.Duration.from({ minutes: 5 }) });
    await kv.set(["kept"], 2);
    clock.set(new Date(clock.now().getTime() + 4 * 60_000).toISOString());
    expect(await kv.get(["cache", "doc"])).toBe(1);
    clock.set(new Date(clock.now().getTime() + 2 * 60_000).toISOString());
    expect(await kv.get(["cache", "doc"])).toBeUndefined();
    expect(await all()).toEqual([{ key: ["kept"], value: 2 }]);
    // Housekeeping removes the expired rows for good.
    expect(await store().deleteExpired()).toBe(1);
  });

  it("lists by prefix: the key itself and longer keys, not a key that merely starts alike", async () => {
    const kv = store();
    await kv.set(["actor"], 0);
    await kv.set(["actor", "one"], 1);
    await kv.set(["actor", "two", "x"], 2);
    await kv.set(["actors", "three"], 3);
    // In no particular order (Fedify asks for none).
    const keys = (await all(["actor"])).map((entry) => entry.key.join("/")).sort();
    expect(keys).toEqual(["actor", "actor/one", "actor/two/x"]);
  });

  it("swaps a value only when it still is the expected one", async () => {
    const kv = store();
    expect(await kv.cas?.(["lock"], undefined, "mine")).toBe(true);
    expect(await kv.cas?.(["lock"], undefined, "theirs")).toBe(false);
    expect(await kv.cas?.(["lock"], "mine", "next")).toBe(true);
    expect(await kv.get(["lock"])).toBe("next");
    // No new value: delete if it still is the expected one (Fedify's replay check does this).
    expect(await kv.cas?.(["lock"], "mine", undefined)).toBe(false);
    expect(await kv.cas?.(["lock"], "next", undefined)).toBe(true);
    expect(await kv.get(["lock"])).toBeUndefined();
    await kv.set(["gone"], 1);
    await kv.set(["gone"], undefined);
    expect(await all(["gone"])).toEqual([]);
  });
});
