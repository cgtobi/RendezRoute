import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createChannelRepository } from "../../../../src/adapters/out/sqlite/channels.ts";
import { createJobQueue } from "../../../../src/adapters/out/sqlite/jobs.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import type { PushSubscription } from "../../../../src/domain/push.ts";
import { endpointOf } from "../../../fakes/channels.ts";
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

    expect((await repo.listFor(responder)).map(endpointOf)).toEqual([
      subscription("a").endpoint,
      subscription("b").endpoint,
    ]);
    expect(await repo.has(host, subscription("a").endpoint)).toBe(true);
    expect(await repo.has(host, subscription("b").endpoint)).toBe(false);
    expect(await repo.findById(id)).toEqual({
      id,
      owner: responder,
      kind: "webpush",
      subscription: subscription("a"),
      verified: true,
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

describe("email channels (spec 7, decision D31)", () => {
  it("keep one address per owner, unconfirmed until confirmed", async () => {
    await seed();
    const repo = channels();
    const owner = { responseId: "response-1" };
    const push = await repo.add(owner, subscription("a"));
    const first = await repo.setEmail(owner, "ben@example.org");
    expect(await repo.emailFor(owner)).toEqual({
      id: first,
      owner,
      kind: "email",
      address: "ben@example.org",
      verified: false,
    });
    // A new address replaces the old one, confirmed or not; push channels stay.
    expect(await repo.confirm(first)).toBe(true);
    const second = await repo.setEmail(owner, "benjamin@example.org");
    expect(second).not.toBe(first);
    expect(await repo.findById(first)).toBeUndefined();
    expect((await repo.emailFor(owner))?.verified).toBe(false);
    expect((await repo.listFor(owner)).map((channel) => channel.id)).toEqual([push, second]);
    expect(await repo.confirm("no-such-channel")).toBe(false);
  });

  it("go with their response or plan together with the queued confirmation (spec 3.10)", async () => {
    await seed();
    const repo = channels();
    const jobs = createJobQueue(database, cipher, new SequentialIdGenerator());
    const count = (table: string) =>
      (database.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
    const responseChannel = await repo.setEmail({ responseId: "response-1" }, "ben@example.org");
    await jobs.enqueue({
      type: "channelConfirmation",
      payload: { channelId: responseChannel },
      responseId: "response-1",
      runAt: fixtureNow,
    });
    const planChannel = await repo.setEmail({ planId: "plan-1" }, "anna@example.org");
    await jobs.enqueue({
      type: "channelConfirmation",
      payload: { channelId: planChannel },
      planId: "plan-1",
      runAt: fixtureNow,
    });
    database.sqlite.prepare("delete from responses").run();
    expect([count("notification_channels"), count("job_queue")]).toEqual([1, 1]);
    database.sqlite.prepare("delete from plans").run();
    expect([count("notification_channels"), count("job_queue")]).toEqual([0, 0]);
  });

  it("store the address encrypted, and go with their response or plan", async () => {
    await seed();
    const repo = channels();
    await repo.setEmail({ responseId: "response-1" }, "SENTINEL-ben@example.org");
    await repo.setEmail({ planId: "plan-1" }, "SENTINEL-anna@example.org");
    expect(
      JSON.stringify(database.sqlite.prepare("select * from notification_channels").all()),
    ).not.toContain("SENTINEL");
    database.sqlite.prepare("delete from plans").run();
    expect(
      database.sqlite.prepare("select count(*) as n from notification_channels").get(),
    ).toEqual({ n: 0 });
  });
});
