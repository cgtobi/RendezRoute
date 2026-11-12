import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createRecapRepository } from "../../../../src/adapters/out/sqlite/recap.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import type { RecapContribution } from "../../../../src/domain/recap.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const recap = () => createRecapRepository(database, cipher);

beforeEach(async () => {
  database = await openDatabase(":memory:");
  await createDeviceRepository(database).create({
    id: "device-1",
    tokenHash: "d1",
    now: fixtureNow,
  });
  await createPlanRepository(database, cipher).create({
    plan: samplePlan({ id: "plan-1" }),
    hostTokenHash: "host",
    creationNonce: "nonce",
    hostDeviceId: "device-1",
  });
  await createResponseRepository(database, cipher, createLookupHasher(randomBytes(32))).create({
    response: {
      id: "response-1",
      planId: "plan-1",
      kind: "joined",
      displayName: "Ben",
      language: "en",
      previousKind: undefined,
      createdAt: fixtureNow,
      updatedAt: fixtureNow,
    },
    manageTokenHash: "manage",
    creationNonce: "nonce-response",
    deviceId: undefined,
  });
});
afterEach(async () => {
  await database.close();
});

const contribution = (
  id: string,
  overrides: Partial<RecapContribution> = {},
): RecapContribution => ({
  id,
  planId: "plan-1",
  responseId: "response-1",
  body: "SENTINEL-recap-body",
  linkUrl: "https://www.strava.com/activities/SENTINEL",
  hiddenByHost: false,
  createdAt: fixtureNow,
  updatedAt: fixtureNow,
  ...overrides,
});

describe("recap contributions (spec 6 feature 5)", () => {
  it("are stored encrypted and listed oldest first, the host's without a response", async () => {
    await recap().create(contribution("c-2", { createdAt: new Date(fixtureNow.getTime() + 1) }));
    await recap().create(contribution("c-1", { responseId: undefined, linkUrl: undefined }));
    expect((await recap().listByPlan("plan-1")).map((c) => c.id)).toEqual(["c-1", "c-2"]);
    expect(await recap().findById("c-2")).toEqual(
      contribution("c-2", { createdAt: new Date(fixtureNow.getTime() + 1) }),
    );
    const raw = JSON.stringify(database.sqlite.prepare("select * from recap_contributions").all());
    expect(raw).not.toContain("SENTINEL");
  });

  it("are updated, hidden, counted per plan and per author, and deleted", async () => {
    await recap().create(contribution("c-1"));
    await recap().create(contribution("c-2", { responseId: undefined }));
    const later = new Date(fixtureNow.getTime() + 1000);
    await recap().update(
      contribution("c-1", { body: "Edited", hiddenByHost: true, updatedAt: later }),
    );
    expect(await recap().findById("c-1")).toMatchObject({ body: "Edited", hiddenByHost: true });
    expect(await recap().countByAuthor("plan-1", "response-1")).toBe(1);
    expect(await recap().countByAuthor("plan-1", undefined)).toBe(1);
    expect(await recap().countByPlan("plan-1")).toBe(2);
    expect(await recap().countByPlan("plan-2")).toBe(0);
    await recap().delete("c-1");
    expect(await recap().findById("c-1")).toBeUndefined();
  });

  it("are deleted per person, per plan, and with their response or plan", async () => {
    await recap().create(contribution("c-1"));
    await recap().create(contribution("c-2", { responseId: undefined }));
    await recap().deleteForResponse("response-1");
    expect((await recap().listByPlan("plan-1")).map((c) => c.id)).toEqual(["c-2"]);
    expect(await recap().deleteForPlan("plan-1")).toBe(1);
    await recap().create(contribution("c-3"));
    database.sqlite.prepare("delete from responses").run();
    expect(await recap().findById("c-3")).toBeUndefined();
    await recap().create(contribution("c-4", { responseId: undefined }));
    await createPlanRepository(database, cipher).delete("plan-1");
    expect(await recap().findById("c-4")).toBeUndefined();
  });

  it("need a comment or a link", async () => {
    await expect(
      recap().create(contribution("c-1", { body: undefined, linkUrl: undefined })),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
