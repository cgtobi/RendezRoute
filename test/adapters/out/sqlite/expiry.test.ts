import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import type { Plan } from "../../../../src/domain/plan.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let dir: string;
let path: string;
let database: Database;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "rendezroute-expiry-"));
  path = join(dir, "rendezroute.db");
  database = await openDatabase(path);
});
afterEach(async () => {
  await database.close();
  rmSync(dir, { recursive: true, force: true });
});

const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const repos = () => ({
  plans: createPlanRepository(database, cipher),
  devices: createDeviceRepository(database),
});

let counter = 0;
async function addPlan(overrides: Partial<Plan>) {
  const { plans, devices } = repos();
  const n = ++counter;
  await devices.create({ id: `host-${n}`, tokenHash: `host-hash-${n}`, now: fixtureNow });
  const plan = samplePlan({ id: `plan-${n}`, ...overrides });
  await plans.create({
    plan,
    hostTokenHash: `token-${n}`,
    creationNonce: `nonce-${n}`,
    hostDeviceId: `host-${n}`,
  });
  return plan;
}

describe("plans due for deletion (spec 3.10)", () => {
  it("finds plans whose delete_at has passed, cancelled ones included", async () => {
    const due = await addPlan({ deleteAt: new Date("2026-06-21T05:30:00Z") });
    const cancelled = await addPlan({
      deleteAt: new Date("2026-06-21T05:00:00Z"),
      status: "cancelled",
    });
    await addPlan({ deleteAt: new Date("2026-06-21T05:31:00Z") });
    const found = await repos().plans.findDueForDeletion(new Date("2026-06-21T05:30:00Z"));
    expect(found.map((plan) => plan.id).sort((a, b) => a.localeCompare(b))).toEqual(
      [cancelled.id, due.id].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("deletes several plans at once and leaves no trace in the files (security test)", async () => {
    const first = await addPlan({ title: "SENTINEL-first-title" });
    const second = await addPlan({ title: "SENTINEL-second-title" });
    const kept = await addPlan({ title: "kept plan" });
    await repos().plans.deleteMany([first.id, second.id]);
    expect(await repos().plans.findById(kept.id)).toBeDefined();
    const raw = [path, `${path}-wal`]
      .filter(existsSync)
      .map((f) => readFileSync(f).toString("latin1"))
      .join("");
    expect(raw).not.toContain("SENTINEL-first-title");
    expect(raw).not.toContain("SENTINEL-second-title");
  });

  it("deletes in chunks, so a large backlog stays below SQLite's parameter limit", async () => {
    const insert = database.sqlite.prepare(
      `insert into plans (id, poster_name, poster_language, activity_type, title, starts_at, timezone, area_label,
        drop_policy, recap_window, retention_days, delete_at, host_token_hash, created_at, updated_at)
       values (?, 'A', 'en', 'run', 'R', 't', 'UTC', 'P', 'no_drop', '1d', 1, 't', ?, 't', 't')`,
    );
    const ids = Array.from({ length: 33_000 }, (_, i) => `bulk-${i}`); // above the 32,766 limit
    database.sqlite.transaction(() => ids.forEach((id) => insert.run(id, `h-${id}`)))();
    await repos().plans.deleteMany(ids);
    expect(
      (database.sqlite.prepare("select count(*) as n from plans").get() as { n: number }).n,
    ).toBe(0);
  });

  it("does nothing for an empty list", async () => {
    await expect(repos().plans.deleteMany([])).resolves.toBeUndefined();
  });
});

describe("plans above a retention maximum (apply-retention-max)", () => {
  it("finds plans with a longer retention", async () => {
    const long = await addPlan({ retentionDays: 30, recapWindow: "1w" });
    await addPlan({ retentionDays: 7, recapWindow: "1w" });
    const found = await repos().plans.findWithRetentionAbove(7);
    expect(found.map((plan) => plan.id)).toEqual([long.id]);
  });
});

describe("device expiry (spec 3.10 Other expiry, decision D9)", () => {
  it("deletes unlinked devices inactive for 30 days and any device inactive for 12 months", async () => {
    const { devices } = repos();
    const at = (iso: string) => new Date(iso);
    await devices.create({ id: "unlinked-old", tokenHash: "a", now: at("2026-04-01T00:00:00Z") });
    await devices.create({
      id: "unlinked-recent",
      tokenHash: "b",
      now: at("2026-05-20T00:00:00Z"),
    });
    await addPlan({});
    await devices.touch(`host-${counter}`, at("2025-05-01T00:00:00Z")); // linked, unused for over a year
    await addPlan({});
    await devices.touch(`host-${counter}`, at("2026-01-01T00:00:00Z")); // linked, old but within a year

    const deleted = await devices.deleteInactive({
      unlinkedLastSeenBefore: at("2026-05-02T08:00:00Z"),
      anyLastSeenBefore: at("2025-06-01T08:00:00Z"),
    });
    expect(deleted).toBe(2);
    expect(await devices.findByTokenHash("a")).toBeUndefined();
    expect(await devices.findByTokenHash("b")).toBeDefined();
    expect(await devices.findByTokenHash(`host-hash-${counter - 1}`)).toBeUndefined();
    expect(await devices.findByTokenHash(`host-hash-${counter}`)).toBeDefined();
  });
});
