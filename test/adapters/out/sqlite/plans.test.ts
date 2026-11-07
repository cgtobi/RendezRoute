import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
beforeEach(async () => {
  database = await openDatabase(":memory:");
});
afterEach(async () => {
  await database.close();
});

const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const repos = () => ({
  plans: createPlanRepository(database, cipher),
  devices: createDeviceRepository(database),
});

async function seed() {
  const { plans, devices } = repos();
  await devices.create({ id: "device-1", tokenHash: "device-hash-1", now: fixtureNow });
  const plan = samplePlan();
  await plans.create({
    plan,
    hostTokenHash: "host-hash-1",
    creationNonce: "nonce-1",
    hostDeviceId: "device-1",
  });
  return plan;
}

describe("PlanRepository", () => {
  it("stores and loads a plan unchanged", async () => {
    const plan = await seed();
    expect(await repos().plans.findById(plan.id)).toEqual(plan);
  });

  it("round-trips optional fields when they are absent", async () => {
    const { plans, devices } = repos();
    await devices.create({ id: "device-2", tokenHash: "device-hash-2", now: fixtureNow });
    const plan = samplePlan(
      { id: "plan-bare" },
      {
        exactDescription: "",
        exactLat: "",
        exactLng: "",
        note: "",
        distanceKm: "",
        paceFrom: "",
        paceTo: "",
      },
    );
    await plans.create({
      plan,
      hostTokenHash: "host-hash-2",
      creationNonce: "nonce-2",
      hostDeviceId: "device-2",
    });
    expect(await plans.findById("plan-bare")).toEqual(plan);
  });

  it("finds plans by host token hash and creation nonce", async () => {
    const plan = await seed();
    expect((await repos().plans.findByHostTokenHash("host-hash-1"))?.id).toBe(plan.id);
    expect(await repos().plans.findByHostTokenHash("other")).toBeUndefined();
    expect(await repos().plans.findIdByCreationNonce("nonce-1")).toBe(plan.id);
    expect(await repos().plans.findIdByCreationNonce("nonce-x")).toBeUndefined();
  });

  it("links the creating device as host in the same step", async () => {
    const plan = await seed();
    expect(await repos().devices.hasLink("device-1", { role: "host", planId: plan.id })).toBe(true);
  });

  it("encrypts the exact start: neither coordinates nor description appear in the row (spec 3.11)", async () => {
    const plan = await seed();
    const row = database.sqlite.prepare("select * from plans where id = ?").get(plan.id) as Record<
      string,
      unknown
    >;
    const raw = JSON.stringify(row);
    expect(raw).not.toContain("North gate");
    expect(raw).not.toContain("48.16321");
    expect(raw).not.toContain("11.60147");
    expect(row.exact_location_enc).toMatch(/^v1\./);
    expect(row.area_lat).toBe(48.16);
  });

  it("stores only the host token hash", async () => {
    await seed();
    const row = database.sqlite.prepare("select host_token_hash from plans").get() as {
      host_token_hash: string;
    };
    expect(row.host_token_hash).toBe("host-hash-1");
  });

  it("returns nothing for unknown IDs", async () => {
    expect(await repos().plans.findById("missing")).toBeUndefined();
  });
});

describe("DeviceRepository", () => {
  it("creates, finds and touches devices", async () => {
    const { devices } = repos();
    await devices.create({ id: "device-1", tokenHash: "hash-1", now: fixtureNow });
    expect(await devices.findByTokenHash("hash-1")).toEqual({
      id: "device-1",
      lastSeenAt: fixtureNow,
    });
    const later = new Date("2026-06-03T00:00:00Z");
    await devices.touch("device-1", later);
    expect(await devices.findByTokenHash("hash-1")).toEqual({ id: "device-1", lastSeenAt: later });
    expect(await devices.findByTokenHash("nope")).toBeUndefined();
  });

  it("links a device as host idempotently", async () => {
    const plan = await seed();
    const { devices } = repos();
    await devices.create({ id: "device-2", tokenHash: "hash-2", now: fixtureNow });
    expect(await devices.hasLink("device-2", { role: "host", planId: plan.id })).toBe(false);
    await devices.link("device-2", { role: "host", planId: plan.id }, fixtureNow);
    await devices.link("device-2", { role: "host", planId: plan.id }, fixtureNow);
    expect(await devices.hasLink("device-2", { role: "host", planId: plan.id })).toBe(true);
  });
});

describe("deleting a plan", () => {
  it("removes its device links and creation nonce (spec 2b privacy: no row references a deleted plan)", async () => {
    const plan = await seed();
    database.sqlite.prepare("delete from plans where id = ?").run(plan.id);
    for (const table of ["device_links", "plan_creation_nonces"]) {
      const count = database.sqlite
        .prepare(`select count(*) as n from ${table} where plan_id = ?`)
        .get(plan.id) as { n: number };
      expect(count.n).toBe(0);
    }
  });
});
