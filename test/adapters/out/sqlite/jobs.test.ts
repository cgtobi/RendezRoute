import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createJobQueue } from "../../../../src/adapters/out/sqlite/jobs.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
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
const queue = () => createJobQueue(database, cipher, new SequentialIdGenerator());
const at = (iso: string) => new Date(iso);

async function seedPlanWithResponse() {
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

describe("job queue (spec 4 job_queue, 6 feature 12)", () => {
  it("returns due jobs in order, up to the limit", async () => {
    const jobs = queue();
    await jobs.enqueue({
      type: "notification",
      payload: { n: 2 },
      runAt: at("2026-11-08T10:02:00Z"),
    });
    await jobs.enqueue({
      type: "notification",
      payload: { n: 1 },
      runAt: at("2026-11-08T10:01:00Z"),
    });
    await jobs.enqueue({
      type: "notification",
      payload: { n: 3 },
      runAt: at("2026-11-08T11:00:00Z"),
    });
    const due = await jobs.due(at("2026-11-08T10:30:00Z"), 10);
    expect(due.map((job) => job.payload)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(await jobs.due(at("2026-11-08T10:30:00Z"), 1)).toHaveLength(1);
  });

  it("reschedules, completes and expires jobs", async () => {
    const jobs = queue();
    const id = await jobs.enqueue({
      type: "notification",
      payload: {},
      runAt: at("2026-11-08T10:00:00Z"),
      expiresAt: at("2026-11-09T10:00:00Z"),
    });
    await jobs.retry(id, at("2026-11-08T10:05:00Z"), "TypeError");
    expect(await jobs.due(at("2026-11-08T10:01:00Z"), 10)).toEqual([]);
    expect(await jobs.due(at("2026-11-08T10:05:00Z"), 10)).toEqual([
      { id, type: "notification", payload: {}, attempts: 1, expiresAt: at("2026-11-09T10:00:00Z") },
    ]);
    expect(await jobs.deleteExpired(at("2026-11-09T10:00:00Z"))).toBe(1);
    const other = await jobs.enqueue({ type: "notification", payload: {}, runAt: fixtureNow });
    await jobs.complete(other);
    expect(await jobs.due(at("2030-01-01T00:00:00Z"), 10)).toEqual([]);
  });

  it("stores payloads encrypted and errors only as given", async () => {
    await queue().enqueue({
      type: "notification",
      payload: { secret: "SENTINEL-payload" },
      runAt: fixtureNow,
    });
    const raw = JSON.stringify(database.sqlite.prepare("select * from job_queue").all());
    expect(raw).not.toContain("SENTINEL-payload");
  });

  it("deletes a plan's and a response's jobs with them", async () => {
    await seedPlanWithResponse();
    const jobs = queue();
    await jobs.enqueue({ type: "notification", payload: {}, runAt: fixtureNow, planId: "plan-1" });
    await jobs.enqueue({
      type: "notification",
      payload: {},
      runAt: fixtureNow,
      responseId: "response-1",
    });
    await jobs.enqueue({ type: "notification", payload: { standalone: true }, runAt: fixtureNow });
    database.sqlite.prepare("delete from responses where id = 'response-1'").run();
    expect(await jobs.due(fixtureNow, 10)).toHaveLength(2);
    database.sqlite.prepare("delete from plans where id = 'plan-1'").run();
    expect((await jobs.due(fixtureNow, 10)).map((job) => job.payload)).toEqual([
      { standalone: true },
    ]);
  });
});
