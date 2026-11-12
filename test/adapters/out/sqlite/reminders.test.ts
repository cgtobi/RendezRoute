import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createSentReminderRepository } from "../../../../src/adapters/out/sqlite/reminders.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import { REMINDER_KINDS } from "../../../../src/domain/reminders.ts";
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
const DUE = new Date("2026-06-06T16:00:00Z");

async function seed(planId = "plan-1", overrides = {}) {
  const devices = createDeviceRepository(database);
  if ((await devices.findByTokenHash("d1")) === undefined) {
    await devices.create({ id: "device-1", tokenHash: "d1", now: fixtureNow });
  }
  await plans().create({
    plan: samplePlan({ id: planId, ...overrides }),
    hostTokenHash: `host-${planId}`,
    creationNonce: `nonce-${planId}`,
    hostDeviceId: "device-1",
  });
}

async function seedResponse() {
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
    manageTokenHash: "manage-hash",
    creationNonce: "nonce-response",
    deviceId: "device-1",
  });
}

describe("sent reminders (decision I39)", () => {
  it("are remembered per kind, plan, response and due moment", async () => {
    await seed();
    await seedResponse();
    const sent = createSentReminderRepository(database);
    const forBen = {
      kind: "dayBefore" as const,
      planId: "plan-1",
      responseId: "response-1",
      dueAt: DUE,
    };
    expect(await sent.wasSent(forBen)).toBe(false);
    await sent.record(forBen);
    await sent.record(forBen);
    expect(await sent.wasSent(forBen)).toBe(true);

    expect(await sent.wasSent({ ...forBen, dueAt: new Date("2026-06-07T16:00:00Z") })).toBe(false);
    const forPlan = { kind: "deletionReminder" as const, planId: "plan-1", dueAt: DUE };
    expect(await sent.wasSent(forPlan)).toBe(false);
    await sent.record(forPlan);
    await sent.record(forPlan);
    expect(await sent.wasSent(forPlan)).toBe(true);
    expect(database.sqlite.prepare("select count(*) from sent_reminders").pluck().get()).toBe(2);
  });

  it("go with their response and their plan", async () => {
    await seed();
    await seedResponse();
    const sent = createSentReminderRepository(database);
    await sent.record({
      kind: "dayBefore",
      planId: "plan-1",
      responseId: "response-1",
      dueAt: DUE,
    });
    await sent.record({ kind: "deletionReminder", planId: "plan-1", dueAt: DUE });
    await createResponseRepository(database, cipher, createLookupHasher(randomBytes(32))).delete(
      "response-1",
    );
    expect(database.sqlite.prepare("select count(*) from sent_reminders").pluck().get()).toBe(1);
    await plans().delete("plan-1");
    expect(database.sqlite.prepare("select count(*) from sent_reminders").pluck().get()).toBe(0);
  });

  it("accept exactly the domain kinds", async () => {
    await seed();
    const insert = (kind: string) => {
      try {
        database.sqlite
          .prepare("insert into sent_reminders (plan_id, kind, due_at) values ('plan-1', ?, ?)")
          .run(kind, `${kind}-due`);
        return true;
      } catch {
        return false;
      }
    };
    expect(REMINDER_KINDS.map(insert)).toEqual(REMINDER_KINDS.map(() => true));
    expect(insert("unknown")).toBe(false);
  });
});

describe("PlanRepository reminder queries", () => {
  it("find active plans starting or being deleted within a range, bounds included", async () => {
    const at = (start: string, end: string) => ({
      startsAt: new Date(start),
      deleteAt: new Date(end),
    });
    await seed("early", at("2026-06-07T05:00:00Z", "2026-06-21T05:00:00Z"));
    await seed("late", at("2026-06-08T05:00:00Z", "2026-06-22T05:00:00Z"));
    await seed("cancelled", {
      ...at("2026-06-07T06:00:00Z", "2026-06-22T05:00:00Z"),
      status: "cancelled",
    });
    const ids = (found: { id: string }[]) => found.map((plan) => plan.id).sort();

    expect(
      ids(
        await plans().findActiveStartingBetween(
          new Date("2026-06-07T05:00:00Z"),
          new Date("2026-06-07T23:00:00Z"),
        ),
      ),
    ).toEqual(["early"]);
    expect(
      ids(
        await plans().findActiveDeletingBetween(
          new Date("2026-06-21T06:00:00Z"),
          new Date("2026-06-22T05:00:00Z"),
        ),
      ),
    ).toEqual(["late"]);
  });
});
