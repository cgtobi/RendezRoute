import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createRatingRepository } from "../../../../src/adapters/out/sqlite/ratings.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import type { PlanRating } from "../../../../src/domain/rating.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const ratings = () => createRatingRepository(database, cipher);

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

const rating = (overrides: Partial<PlanRating> = {}): PlanRating => ({
  id: "rating-1",
  planId: "plan-1",
  responseId: "response-1",
  value: "down",
  note: "SENTINEL-rating-note",
  createdAt: fixtureNow,
  updatedAt: fixtureNow,
  ...overrides,
});

describe("SQLite plan ratings (spec 6a, section 4)", () => {
  it("store one rating per response, the note encrypted", async () => {
    await ratings().save(rating());
    expect(await ratings().findByResponse("response-1")).toEqual(rating());
    const raw = JSON.stringify(database.sqlite.prepare("select * from plan_ratings").all());
    expect(raw).not.toContain("SENTINEL");
  });

  it("replace the value and note, keeping the rating's ID and creation time", async () => {
    await ratings().save(rating());
    const later = new Date(fixtureNow.getTime() + 1000);
    await ratings().save(
      rating({ id: "rating-2", value: "up", note: undefined, createdAt: later, updatedAt: later }),
    );
    expect(await ratings().findByResponse("response-1")).toEqual(
      rating({ value: "up", note: undefined, updatedAt: later }),
    );
  });

  it("are listed per plan, oldest first", async () => {
    await ratings().save(rating());
    expect(await ratings().listByPlan("plan-1")).toEqual([rating()]);
    expect(await ratings().listByPlan("plan-2")).toEqual([]);
  });

  it("are deleted on request, and with their response or plan", async () => {
    await ratings().save(rating());
    await ratings().deleteForResponse("response-1");
    expect(await ratings().findByResponse("response-1")).toBeUndefined();
    await ratings().save(rating());
    database.sqlite.prepare("delete from responses").run();
    expect(await ratings().findByResponse("response-1")).toBeUndefined();
  });

  it("accept only up and down", () => {
    const insert = (value: string) => () =>
      database.sqlite
        .prepare(
          "insert into plan_ratings (id, plan_id, response_id, value, created_at, updated_at) values ('r', 'plan-1', 'response-1', ?, 't', 't')",
        )
        .run(value);
    expect(insert("meh")).toThrow(/CHECK constraint failed/);
    expect(insert("up")).not.toThrow();
  });
});
