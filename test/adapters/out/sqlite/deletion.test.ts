// Spec 1.6 real deletion and 3.10 physical deletion for manual deletions (decision D8).
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
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let dir: string;
let path: string;
let database: Database;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "rendezroute-deletion-"));
  path = join(dir, "rendezroute.db");
  database = await openDatabase(path);
});
afterEach(async () => {
  await database.close();
  rmSync(dir, { recursive: true, force: true });
});

const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const PLAN_ID = "SENTINELplanId00000001";
const NAME = "SENTINEL-participant-name";

/** Raw bytes of the database and its WAL, as an attacker with the files would see them. */
const raw = () =>
  [path, `${path}-wal`]
    .filter(existsSync)
    .map((file) => readFileSync(file).toString("latin1"))
    .join("");

async function seed() {
  const plans = createPlanRepository(database, cipher);
  const devices = createDeviceRepository(database);
  const responses = createResponseRepository(database, cipher);
  await devices.create({ id: "device-1", tokenHash: "hash-1", now: fixtureNow });
  await plans.create({
    plan: samplePlan({ id: PLAN_ID, title: "SENTINEL title" }),
    hostTokenHash: "host-hash",
    creationNonce: "nonce-1",
    hostDeviceId: "device-1",
  });
  await responses.create({
    response: {
      id: "response-1",
      planId: PLAN_ID,
      kind: "joined",
      displayName: NAME,
      language: "en",
      previousKind: undefined,
      createdAt: fixtureNow,
      updatedAt: fixtureNow,
    },
    manageTokenHash: "manage-hash",
    creationNonce: "nonce-2",
    deviceId: "device-1",
  });
  return { plans, responses };
}

describe("PlanRepository.update", () => {
  it("stores every changed field, re-encrypting the exact start", async () => {
    const { plans } = await seed();
    const original = await plans.findById(PLAN_ID);
    if (original === undefined) throw new Error("missing");
    const changed = {
      ...original,
      title: "New title",
      exactStart: { point: { lat: 47.1, lng: 10.2 }, description: "New spot" },
      area: { label: "New area", point: { lat: 47.1, lng: 10.2 } },
      status: "cancelled" as const,
      retentionDays: 3,
      recapWindow: "1d" as const,
      deleteAt: new Date("2026-06-10T05:30:00Z"),
      updatedAt: new Date("2026-06-02T00:00:00Z"),
    };
    await plans.update(changed);
    expect(await plans.findById(PLAN_ID)).toEqual(changed);
    expect(JSON.stringify(database.sqlite.prepare("select * from plans").get())).not.toContain(
      "New spot",
    );
  });
});

describe("PlanRepository.delete (spec 5 feature 9)", () => {
  it("removes the plan and everything referencing it, leaving no trace in the files", async () => {
    const { plans } = await seed();
    await plans.delete(PLAN_ID);

    const tables = database.sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .pluck()
      .all() as string[];
    for (const table of tables) {
      const rows = JSON.stringify(database.sqlite.prepare(`select * from "${table}"`).all());
      // The table name shows up in the failure message.
      expect({ table, referencesPlan: rows.includes(PLAN_ID) }).toEqual({
        table,
        referencesPlan: false,
      });
    }
    const content = raw();
    expect(content).not.toContain(PLAN_ID);
    expect(content).not.toContain("SENTINEL title");
  });
});

describe("ResponseRepository.delete (withdraw)", () => {
  it("leaves no trace of the response in the files (spec 3.10, decision D8)", async () => {
    const { responses } = await seed();
    await responses.delete("response-1");
    expect(raw()).not.toContain("manage-hash");
    expect(
      (database.sqlite.prepare("select count(*) as n from responses").get() as { n: number }).n,
    ).toBe(0);
  });
});
