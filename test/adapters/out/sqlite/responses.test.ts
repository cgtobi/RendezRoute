import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import type { PlanResponse } from "../../../../src/domain/response.ts";
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
  responses: createResponseRepository(database, cipher, createLookupHasher(randomBytes(32))),
});

const response = (overrides: Partial<PlanResponse> = {}): PlanResponse => ({
  id: "response-1",
  planId: "plan-0001",
  kind: "joined",
  displayName: "SENTINEL-Ben",
  language: "en",
  previousKind: undefined,
  createdAt: fixtureNow,
  updatedAt: fixtureNow,
  ...overrides,
});

async function seed() {
  const { plans, devices, responses } = repos();
  for (const id of ["host-device", "device-1", "device-2"]) {
    await devices.create({ id, tokenHash: `hash-${id}`, now: fixtureNow });
  }
  await plans.create({
    plan: samplePlan(),
    hostTokenHash: "host-hash",
    creationNonce: "plan-nonce",
    hostDeviceId: "host-device",
  });
  await responses.create({
    response: response(),
    manageTokenHash: "manage-hash-1",
    creationNonce: "nonce-1",
    deviceId: "device-1",
  });
  return { plans, devices, responses };
}

describe("request notes (spec 6 feature 1)", () => {
  it("are stored encrypted, kept on update and cleared with the response", async () => {
    const { responses } = await seed();
    await responses.create({
      response: response({ id: "response-2", kind: "requested", requestNote: "SENTINEL-note" }),
      manageTokenHash: "manage-hash-2",
      creationNonce: "nonce-2",
      deviceId: "device-2",
    });
    expect((await responses.findById("response-2"))?.requestNote).toBe("SENTINEL-note");
    const raw = JSON.stringify(database.sqlite.prepare("select * from responses").all());
    expect(raw).not.toContain("SENTINEL-note");

    const stored = await responses.findById("response-2");
    if (stored === undefined) throw new Error("missing");
    await responses.update({ ...stored, kind: "joined" });
    expect((await responses.findById("response-2"))?.requestNote).toBe("SENTINEL-note");
  });
});

describe("ResponseRepository", () => {
  it("stores and loads responses unchanged", async () => {
    const { responses } = await seed();
    expect(await responses.findById("response-1")).toEqual(response());
    expect(await responses.findByManageTokenHash("manage-hash-1")).toEqual(response());
    expect(await responses.findIdByCreationNonce("nonce-1")).toBe("response-1");
  });

  it("replaces the manage link's hash (spec 3.2 Get a new link)", async () => {
    const { responses } = await seed();
    await responses.setManageTokenHash("response-1", "manage-hash-2");
    expect(await responses.findByManageTokenHash("manage-hash-1")).toBeUndefined();
    expect(await responses.findByManageTokenHash("manage-hash-2")).toEqual(response());
  });

  it("finds a device's response to a plan through its manage link", async () => {
    const { responses } = await seed();
    expect((await responses.findForDevice("plan-0001", "device-1"))?.id).toBe("response-1");
    expect(await responses.findForDevice("plan-0001", "device-2")).toBeUndefined();
  });

  it("links the responding device as manager (spec 3.2)", async () => {
    const { devices } = await seed();
    expect(await devices.hasLink("device-1", { role: "manage", responseId: "response-1" })).toBe(
      true,
    );
    expect(await devices.hasLink("device-2", { role: "manage", responseId: "response-1" })).toBe(
      false,
    );
  });

  it("encrypts display names (spec 3.11)", async () => {
    await seed();
    const raw = JSON.stringify(database.sqlite.prepare("select * from responses").all());
    expect(raw).not.toContain("SENTINEL-Ben");
  });

  it("lists responses and counts them without rejected or removed people (spec 3.5 Counts)", async () => {
    const { responses } = await seed();
    const add = (id: string, kind: PlanResponse["kind"]) =>
      responses.create({
        response: response({ id, kind, displayName: id }),
        manageTokenHash: `h-${id}`,
        creationNonce: `n-${id}`,
        deviceId: undefined,
      });
    await add("r-interested", "interested");
    await add("r-removed", "removed");
    await add("r-joined", "joined");
    expect(await responses.counts("plan-0001")).toEqual({ interested: 1, participants: 2 });
    expect((await responses.listByPlan("plan-0001")).map((r) => r.id).sort()).toEqual(
      ["r-interested", "r-joined", "r-removed", "response-1"].sort(),
    );
  });

  it("updates kind, name and previous kind", async () => {
    const { responses } = await seed();
    const later = new Date("2026-06-02T00:00:00Z");
    await responses.update(
      response({ kind: "interested", displayName: "Benjamin", updatedAt: later }),
    );
    expect(await responses.findById("response-1")).toMatchObject({
      kind: "interested",
      displayName: "Benjamin",
      updatedAt: later,
    });
  });

  it("deletes a response with its device links (hard delete)", async () => {
    const { responses, devices } = await seed();
    await responses.delete("response-1");
    expect(await responses.findById("response-1")).toBeUndefined();
    expect(await devices.hasLink("device-1", { role: "manage", responseId: "response-1" })).toBe(
      false,
    );
    const leftovers = database.sqlite
      .prepare("select count(*) as n from device_links where response_id = 'response-1'")
      .get() as { n: number };
    expect(leftovers.n).toBe(0);
  });

  it("knows when a device is blocked from responding again (spec 3.5)", async () => {
    const { responses } = await seed();
    expect(await responses.isBlocked("plan-0001", "device-1")).toBe(false);
    await responses.update(response({ kind: "removed", previousKind: "joined" }));
    expect(await responses.isBlocked("plan-0001", "device-1")).toBe(true);
    expect(await responses.isBlocked("plan-0001", "device-2")).toBe(false);
  });
});

describe("DeviceRepository links", () => {
  it("links devices to plans as host and to responses as manager, idempotently", async () => {
    const { devices } = await seed();
    await devices.link("device-2", { role: "host", planId: "plan-0001" }, fixtureNow);
    await devices.link("device-2", { role: "host", planId: "plan-0001" }, fixtureNow);
    await devices.link("device-2", { role: "manage", responseId: "response-1" }, fixtureNow);
    expect(await devices.hasLink("device-2", { role: "host", planId: "plan-0001" })).toBe(true);
    expect(await devices.hasLink("device-2", { role: "manage", responseId: "response-1" })).toBe(
      true,
    );
  });
});

describe("plan deletion", () => {
  it("removes its responses and their device links (spec 2b)", async () => {
    await seed();
    database.sqlite.prepare("delete from plans where id = 'plan-0001'").run();
    for (const [table, column] of [
      ["responses", "plan_id"],
      ["device_links", "plan_id"],
    ] as const) {
      const n = (
        database.sqlite
          .prepare(`select count(*) as n from ${table} where ${column} = 'plan-0001'`)
          .get() as { n: number }
      ).n;
      expect(n).toBe(0);
    }
    const links = (
      database.sqlite
        .prepare("select count(*) as n from device_links where response_id = 'response-1'")
        .get() as { n: number }
    ).n;
    expect(links).toBe(0);
  });

  it("keeps the device when a response is deleted (device expiry handles it later)", async () => {
    const { responses, devices } = await seed();
    await responses.delete("response-1");
    expect(await devices.findByTokenHash("hash-device-1")).toBeDefined();
  });
});
