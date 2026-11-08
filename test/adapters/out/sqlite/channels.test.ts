import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createChannelRepository } from "../../../../src/adapters/out/sqlite/channels.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import type { PushSubscription } from "../../../../src/domain/push.ts";
import { SequentialIdGenerator } from "../../../fakes/ids.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
beforeEach(async () => {
  database = await openDatabase(":memory:");
});
afterEach(async () => {
  await database.close();
});

const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const channels = () =>
  createChannelRepository(database, cipher, new SequentialIdGenerator(), () => fixtureNow);
const subscription = (name: string): PushSubscription => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/SENTINEL-${name}`,
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
});

async function seed() {
  await createDeviceRepository(database).create({
    id: "device-1",
    tokenHash: "d1",
    now: fixtureNow,
  });
  await createPlanRepository(database, cipher).create({
    plan: samplePlan({ id: "plan-1" }),
    hostTokenHash: "host-hash",
    creationNonce: "nonce-plan",
    hostDeviceId: "device-1",
  });
  await createResponseRepository(database, cipher).create({
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
    manageTokenHash: "manage-hash",
    creationNonce: "nonce-response",
    deviceId: "device-1",
  });
}

describe("notification channels (spec 4, 6 feature 3)", () => {
  it("belong to a response or a hosted plan, one per browser subscription", async () => {
    await seed();
    const repo = channels();
    const host = { planId: "plan-1" };
    const responder = { responseId: "response-1" };
    const id = await repo.add(responder, subscription("a"));
    expect(await repo.add(responder, subscription("a"))).toBe(id);
    await repo.add(responder, subscription("b"));
    await repo.add(host, subscription("a"));

    expect((await repo.listFor(responder)).map((c) => c.subscription.endpoint)).toEqual([
      subscription("a").endpoint,
      subscription("b").endpoint,
    ]);
    expect(await repo.has(host, subscription("a").endpoint)).toBe(true);
    expect(await repo.has(host, subscription("b").endpoint)).toBe(false);
    expect(await repo.findById(id)).toEqual({
      id,
      owner: responder,
      subscription: subscription("a"),
    });

    await repo.remove(responder, subscription("a").endpoint);
    expect(await repo.has(responder, subscription("a").endpoint)).toBe(false);
    expect(await repo.has(host, subscription("a").endpoint)).toBe(true);
  });

  it("store the subscription encrypted", async () => {
    await seed();
    await channels().add({ responseId: "response-1" }, subscription("a"));
    const raw = JSON.stringify(
      database.sqlite.prepare("select * from notification_channels").all(),
    );
    expect(raw).not.toContain("SENTINEL");
  });

  it("are deleted with their response or plan", async () => {
    await seed();
    const repo = channels();
    await repo.add({ responseId: "response-1" }, subscription("a"));
    await repo.add({ planId: "plan-1" }, subscription("b"));
    database.sqlite.prepare("delete from responses").run();
    expect(await repo.listFor({ responseId: "response-1" })).toEqual([]);
    expect(await repo.listFor({ planId: "plan-1" })).toHaveLength(1);
    database.sqlite.prepare("delete from plans").run();
    expect(await repo.listFor({ planId: "plan-1" })).toEqual([]);
  });

  it("can be deleted by id once their subscription is gone", async () => {
    await seed();
    const repo = channels();
    const id = await repo.add({ planId: "plan-1" }, subscription("a"));
    await repo.delete(id);
    expect(await repo.findById(id)).toBeUndefined();
  });
});
