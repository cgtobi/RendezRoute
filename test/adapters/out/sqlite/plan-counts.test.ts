// Counts the instance caps and the response cap rely on (0.19.0 commit A).
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import { createReportRepository } from "../../../../src/adapters/out/sqlite/reports.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));

beforeEach(async () => {
  database = await openDatabase(":memory:");
  await createDeviceRepository(database).create({ id: "d", tokenHash: "h", now: fixtureNow });
});
afterEach(async () => {
  await database.close();
});

describe("PlanRepository.countCreatedSince (one query, an hour and a day)", () => {
  it("counts the plans created at or after the time, and forgets deleted ones", async () => {
    const plans = createPlanRepository(database, cipher);
    const at = (minutes: number) => new Date(fixtureNow.getTime() + minutes * 60_000);
    for (const [id, minutes] of [
      ["a", 0],
      ["b", 30],
      ["c", 90],
    ] as const) {
      await plans.create({
        plan: samplePlan({ id, createdAt: at(minutes), updatedAt: at(minutes) }),
        hostTokenHash: `host-${id}`,
        creationNonce: `nonce-${id}`,
        hostDeviceId: "d",
        ownerIdentityId: undefined,
      });
    }
    const since = (hour: number, day: number) =>
      plans.countCreatedSince({ hour: at(hour), day: at(day) });
    expect(await since(30, -1)).toEqual({ lastHour: 2, lastDay: 3 });
    expect(await since(31, 30)).toEqual({ lastHour: 1, lastDay: 2 });
    expect(await since(91, 91)).toEqual({ lastHour: 0, lastDay: 0 });
    await plans.delete("c");
    expect(await since(30, -1)).toEqual({ lastHour: 1, lastDay: 2 });
  });
});

describe("ResponseRepository.countWebResponses", () => {
  it("counts web responses of the plan and leaves out remote participants", async () => {
    const plans = createPlanRepository(database, cipher);
    for (const id of ["p1", "p2"]) {
      await plans.create({
        plan: samplePlan({ id }),
        hostTokenHash: `host-${id}`,
        creationNonce: `nonce-${id}`,
        hostDeviceId: "d",
        ownerIdentityId: undefined,
      });
    }
    const responses = createResponseRepository(
      database,
      cipher,
      createLookupHasher(randomBytes(32)),
    );
    const response = (id: string, planId: string) => ({
      id,
      planId,
      kind: "joined" as const,
      displayName: id,
      language: "en",
      previousKind: undefined,
      createdAt: fixtureNow,
      updatedAt: fixtureNow,
    });
    for (const [id, planId] of [
      ["w1", "p1"],
      ["w2", "p1"],
      ["w3", "p2"],
    ] as const) {
      await responses.create({
        response: response(id, planId),
        manageTokenHash: `manage-${id}`,
        creationNonce: `nonce-${id}`,
        deviceId: "d",
      });
    }
    for (const id of ["r1", "r2", "r3"]) {
      await responses.createRemote({
        response: response(id, "p1"),
        actor: {
          id: `https://social.example/users/${id}`,
          inbox: "https://social.example/inbox",
          sharedInbox: undefined,
        },
        join: { id: `https://social.example/${id}#join`, kind: "join" },
        manageTokenHash: `manage-${id}`,
      });
    }
    expect(await responses.countWebResponses("p1")).toBe(2);
    expect(await responses.countWebResponses("p2")).toBe(1);
    expect(await responses.countWebResponses("none")).toBe(0);
  });
});

describe("countCreatedSince of responses and reports, and listRecent (ADR 009)", () => {
  it("counts rows made at or after the time, and lists the newest plans with response counts", async () => {
    const plans = createPlanRepository(database, cipher);
    const at = (minutes: number) => new Date(fixtureNow.getTime() + minutes * 60_000);
    for (const [id, minutes] of [
      ["old", 0],
      ["new", 60],
    ] as const) {
      await plans.create({
        plan: samplePlan({
          id,
          title: `Plan ${id}`,
          createdAt: at(minutes),
          updatedAt: at(minutes),
        }),
        hostTokenHash: `host-${id}`,
        creationNonce: `nonce-${id}`,
        hostDeviceId: "d",
        ownerIdentityId: undefined,
      });
    }
    const responses = createResponseRepository(
      database,
      cipher,
      createLookupHasher(randomBytes(32)),
    );
    for (const [id, planId, minutes] of [
      ["w1", "new", 61],
      ["w2", "new", 5],
      ["w3", "old", 90],
    ] as const) {
      await responses.create({
        response: {
          id,
          planId,
          kind: "joined" as const,
          displayName: id,
          language: "en",
          previousKind: undefined,
          createdAt: at(minutes),
          updatedAt: at(minutes),
        },
        manageTokenHash: `manage-${id}`,
        creationNonce: `nonce-${id}`,
        deviceId: "d",
      });
    }
    expect(await responses.countCreatedSince(at(60))).toBe(2);
    expect(await responses.countCreatedSince(at(100))).toBe(0);
    const reports = createReportRepository(database, cipher);
    await reports.create({
      id: "rep1",
      planId: "new",
      reason: "spam",
      details: undefined,
      attached: [],
      createdAt: at(70),
      resolvedAt: undefined,
    });
    expect(await reports.countCreatedSince(at(60))).toBe(1);
    expect(await reports.countCreatedSince(at(71))).toBe(0);

    expect(await plans.listRecent(10)).toEqual([
      { id: "new", createdAt: at(60), title: "Plan new", responseCount: 2 },
      { id: "old", createdAt: at(0), title: "Plan old", responseCount: 1 },
    ]);
    expect(await plans.listRecent(1)).toHaveLength(1);
  });
});
