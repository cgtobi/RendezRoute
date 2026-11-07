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
import type { Route } from "../../../../src/domain/route.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let dir: string;
let path: string;
let database: Database;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "rendezroute-routes-"));
  path = join(dir, "rendezroute.db");
  database = await openDatabase(path);
});
afterEach(async () => {
  await database.close();
  rmSync(dir, { recursive: true, force: true });
});

const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const plans = () => createPlanRepository(database, cipher);
const route: Route = {
  segments: [
    [
      { lat: 47.12345, lng: 10.98765, ele: 812.3 },
      { lat: 47.12399, lng: 10.98811 },
    ],
  ],
};
const other: Route = {
  segments: [
    [
      { lat: 46.5, lng: 9.5 },
      { lat: 46.6, lng: 9.6 },
    ],
  ],
};
const raw = () =>
  [path, `${path}-wal`]
    .filter(existsSync)
    .map((f) => readFileSync(f).toString("latin1"))
    .join("");

async function seed(withRoute: Route | undefined) {
  await createDeviceRepository(database).create({ id: "host", tokenHash: "h", now: fixtureNow });
  await plans().create({
    plan: samplePlan({ hasRoute: withRoute !== undefined }),
    hostTokenHash: "token",
    creationNonce: "nonce",
    hostDeviceId: "host",
    route: withRoute,
  });
}

describe("routes (spec 4, decision D10)", () => {
  it("stores a route with the plan, encrypted, and marks the plan as having one", async () => {
    await seed(route);
    expect(await plans().findById("plan-0001")).toMatchObject({ hasRoute: true });
    expect(await plans().findRoute("plan-0001")).toEqual(route);
    expect(raw()).not.toContain("47.12345");
  });

  it("reports plans without a route", async () => {
    await seed(undefined);
    expect(await plans().findById("plan-0001")).toMatchObject({ hasRoute: false });
    expect(await plans().findRoute("plan-0001")).toBeUndefined();
  });

  it("replaces and removes routes, leaving nothing in the files", async () => {
    await seed(route);
    await plans().saveRoute("plan-0001", other);
    expect(await plans().findRoute("plan-0001")).toEqual(other);
    await plans().deleteRoute("plan-0001");
    expect(await plans().findById("plan-0001")).toMatchObject({ hasRoute: false });
    expect(
      (database.sqlite.prepare("select count(*) as n from routes").get() as { n: number }).n,
    ).toBe(0);
  });

  it("is deleted with its plan", async () => {
    await seed(route);
    await plans().delete("plan-0001");
    expect(
      (database.sqlite.prepare("select count(*) as n from routes").get() as { n: number }).n,
    ).toBe(0);
  });
});
