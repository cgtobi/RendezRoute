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
const plans = () => createPlanRepository(database, cipher);
const png = (text: string) => new TextEncoder().encode(text);

async function seed(id: string) {
  await createDeviceRepository(database).create({
    id: `device-${id}`,
    tokenHash: `device-hash-${id}`,
    now: fixtureNow,
  });
  await plans().create({
    plan: samplePlan({ id }),
    hostTokenHash: `host-hash-${id}`,
    creationNonce: `nonce-${id}`,
    hostDeviceId: `device-${id}`,
  });
}

describe("cached preview images (spec 3.10)", () => {
  it("stores one image per plan and returns it only for the current version", async () => {
    await seed("plan-1");
    await plans().savePreview("plan-1", "v1", png("first"));
    expect(await plans().findPreview("plan-1", "v1")).toEqual(png("first"));
    await plans().savePreview("plan-1", "v2", png("second"));
    expect(await plans().findPreview("plan-1", "v1")).toBeUndefined();
    expect(await plans().findPreview("plan-1", "v2")).toEqual(png("second"));
    expect(database.sqlite.prepare("select count(*) as n from plan_previews").get()).toEqual({
      n: 1,
    });
  });

  it("deletes the image with its plan, also in the retention sweep", async () => {
    for (const id of ["plan-1", "plan-2", "plan-3"]) {
      await seed(id);
      await plans().savePreview(id, "v1", png(id));
    }
    await plans().delete("plan-1");
    await plans().deleteMany(["plan-2"]);
    expect(
      database.sqlite.prepare("select plan_id from plan_previews order by plan_id").all(),
    ).toEqual([{ plan_id: "plan-3" }]);
  });

  it("ignores images for plans that no longer exist", async () => {
    await plans().savePreview("gone", "v1", png("x"));
    expect(await plans().findPreview("gone", "v1")).toBeUndefined();
  });
});
