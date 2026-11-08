import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createCalendarFeedRepository } from "../../../../src/adapters/out/sqlite/calendar-feeds.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
beforeEach(async () => {
  database = await openDatabase(":memory:");
  await createDeviceRepository(database).create({
    id: "device-1",
    tokenHash: "d1",
    now: fixtureNow,
  });
});
afterEach(async () => {
  await database.close();
});

const feeds = () => createCalendarFeedRepository(database);
const feed = (id: string, tokenHash: string, language = "de") => ({
  id,
  deviceId: "device-1",
  tokenHash,
  language,
  createdAt: fixtureNow,
});

describe("calendar feeds (spec 6 feature 2)", () => {
  it("are found by token hash and by device", async () => {
    await feeds().replace(feed("feed-1", "hash-1"));
    const expected = { id: "feed-1", deviceId: "device-1", language: "de", createdAt: fixtureNow };
    expect(await feeds().findByTokenHash("hash-1")).toEqual(expected);
    expect(await feeds().findForDevice("device-1")).toEqual(expected);
    expect(await feeds().findByTokenHash("other")).toBeUndefined();
  });

  it("are one per device: a new link replaces the old one", async () => {
    await feeds().replace(feed("feed-1", "hash-1"));
    await feeds().replace(feed("feed-2", "hash-2", "fr"));
    expect(await feeds().findByTokenHash("hash-1")).toBeUndefined();
    expect((await feeds().findForDevice("device-1"))?.id).toBe("feed-2");
    expect(database.sqlite.prepare("select count(*) as n from calendar_feeds").get()).toEqual({
      n: 1,
    });
  });

  it("are deleted on request and with their device", async () => {
    await feeds().replace(feed("feed-1", "hash-1"));
    await feeds().deleteForDevice("device-1");
    expect(await feeds().findForDevice("device-1")).toBeUndefined();
    await feeds().replace(feed("feed-2", "hash-2"));
    database.sqlite.prepare("delete from devices").run();
    expect(await feeds().findByTokenHash("hash-2")).toBeUndefined();
  });
});

async function seedPlanAndResponse() {
  const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
  const devices = createDeviceRepository(database);
  await devices.create({ id: "device-2", tokenHash: "d2", now: fixtureNow });
  const plans = createPlanRepository(database, cipher);
  await plans.create({
    plan: samplePlan({ id: "plan-1", title: "Hosted" }),
    hostTokenHash: "host-1",
    creationNonce: "nonce-1",
    hostDeviceId: "device-1",
  });
  await plans.create({
    plan: samplePlan({ id: "plan-2", title: "Joined" }),
    hostTokenHash: "host-2",
    creationNonce: "nonce-2",
    hostDeviceId: "device-2",
  });
  await createResponseRepository(database, cipher).create({
    response: {
      id: "response-1",
      planId: "plan-2",
      kind: "joined",
      displayName: "Ben",
      language: "en",
      previousKind: undefined,
      createdAt: fixtureNow,
      updatedAt: fixtureNow,
    },
    manageTokenHash: "manage",
    creationNonce: "nonce-response",
    deviceId: "device-1",
  });
  return plans;
}

describe("plans linked to a device", () => {
  it("are the hosted ones and those responded to, with the response's kind, in one query", async () => {
    const plans = await seedPlanAndResponse();
    const linked = await plans.findLinkedToDevice("device-1");
    expect(
      linked.map((entry) => [
        entry.plan.title,
        entry.role,
        "responseKind" in entry && entry.responseKind,
      ]),
    ).toEqual([
      ["Hosted", "host", false],
      ["Joined", "manage", "joined"],
    ]);
    expect(await plans.findLinkedToDevice("unknown")).toEqual([]);
  });
});

describe("feeds of devices with nothing linked (spec 3.10)", () => {
  it("are deleted; feeds of devices with plans or responses stay", async () => {
    await seedPlanAndResponse();
    await createDeviceRepository(database).create({
      id: "device-3",
      tokenHash: "d3",
      now: fixtureNow,
    });
    await feeds().replace(feed("feed-1", "hash-1"));
    await feeds().replace({ ...feed("feed-3", "hash-3"), deviceId: "device-3" });
    expect(await feeds().deleteUnlinked()).toBe(1);
    expect(await feeds().findByTokenHash("hash-1")).toBeDefined();
    expect(await feeds().findByTokenHash("hash-3")).toBeUndefined();
  });
});
