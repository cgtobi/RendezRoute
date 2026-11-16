// The host name a device suggests again (D67, I83): plain columns of plans and templates, read
// through the device's links; a response's name is encrypted and never read.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import { createTemplateRepository } from "../../../../src/adapters/out/sqlite/templates.ts";
import { templateFromPlan } from "../../../../src/domain/template.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const devices = () => createDeviceRepository(database);
const plans = () => createPlanRepository(database, cipher);
const templates = () => createTemplateRepository(database, cipher);
const at = (minutes: number) => new Date(fixtureNow.getTime() + minutes * 60_000);

async function hostPlan(id: string, deviceId: string, posterName: string, minutes: number) {
  await plans().create({
    plan: samplePlan({ id, createdAt: at(minutes), updatedAt: at(minutes) }, { posterName }),
    hostTokenHash: `host-${id}`,
    creationNonce: `nonce-${id}`,
    hostDeviceId: deviceId,
    route: undefined,
  });
}

async function keepTemplate(
  id: string,
  planId: string,
  posterName: string,
  created: number,
  updated = created,
) {
  const plan = samplePlan({ id: planId });
  await templates().create({
    template: {
      ...templateFromPlan(plan, { id, includePrivate: false, now: at(created) }),
      posterName,
      updatedAt: at(updated),
    },
    hostTokenHash: undefined,
    route: undefined,
    hostsOfPlan: planId,
  });
}

beforeEach(async () => {
  database = await openDatabase(":memory:");
  for (const id of ["device-1", "device-2", "device-3", "device-4"]) {
    await devices().create({ id, tokenHash: id, now: fixtureNow });
  }
});
afterEach(async () => {
  await database.close();
});

describe("SQLite lastHostName (D67, I83)", () => {
  it("gives the poster name of the most recently created plan the device hosts", async () => {
    // The newest plan has the larger id on device-1 and the smaller one on device-2, so neither
    // the index order nor an ID ordering alone gives the right answer for both.
    await hostPlan("plan-a", "device-1", "Older", 0);
    await hostPlan("plan-b", "device-1", "Newer", 10);
    await hostPlan("plan-c", "device-2", "Newer 2", 10);
    await hostPlan("plan-d", "device-2", "Older 2", 0);
    await hostPlan("plan-z", "device-4", "Someone else", 20);
    expect(await devices().lastHostName("device-1")).toBe("Newer");
    expect(await devices().lastHostName("device-2")).toBe("Newer 2");
  });

  it("breaks a tie in creation time by the larger plan id", async () => {
    await hostPlan("plan-a", "device-1", "Smaller id", 5);
    await hostPlan("plan-b", "device-1", "Larger id", 5);
    expect(await devices().lastHostName("device-1")).toBe("Larger id");
  });

  it("counts a cancelled plan and skips a blank name", async () => {
    await hostPlan("plan-1", "device-1", "Anna", 0);
    await hostPlan("plan-2", "device-1", "Ben", 10);
    database.sqlite.prepare("update plans set status = 'cancelled' where id = 'plan-2'").run();
    expect(await devices().lastHostName("device-1")).toBe("Ben");
    database.sqlite.prepare("update plans set poster_name = '  ' where id = 'plan-2'").run();
    expect(await devices().lastHostName("device-1")).toBe("Anna");
  });

  it("does not use the plan of a response: a guest has no host name from it", async () => {
    await hostPlan("plan-1", "device-1", "Anna", 0);
    await createResponseRepository(database, cipher, createLookupHasher(randomBytes(32))).create({
      response: {
        id: "response-1",
        planId: "plan-1",
        kind: "joined",
        displayName: "Carla",
        language: "en",
        previousKind: undefined,
        createdAt: fixtureNow,
        updatedAt: fixtureNow,
      },
      manageTokenHash: "manage",
      creationNonce: "nonce-response",
      deviceId: "device-3",
    });
    expect(await devices().hasLink("device-3", { role: "manage", responseId: "response-1" })).toBe(
      true,
    );
    expect(await devices().lastHostName("device-3")).toBeUndefined();
  });

  it("falls back to the latest template linked to the device, after the plan is deleted", async () => {
    await hostPlan("plan-1", "device-1", "Anna", 0);
    // Created in the opposite order of the last change, and the later change has the larger id:
    // only ordering by updated_at, descending, picks "Anna (edited last)".
    await keepTemplate("template-a", "plan-1", "Anna (created last)", 9, 5);
    await keepTemplate("template-b", "plan-1", "Anna (edited last)", 2, 12);
    await plans().delete("plan-1");
    expect(await devices().lastHostName("device-1")).toBe("Anna (edited last)");
    expect(await devices().lastHostName("device-2")).toBeUndefined();
  });

  it("prefers a hosted plan to a template, and gives nothing to a device with neither", async () => {
    await hostPlan("plan-1", "device-1", "Plan name", 0);
    await keepTemplate("template-1", "plan-1", "Template name", 50);
    expect(await devices().lastHostName("device-1")).toBe("Plan name");
    expect(await devices().lastHostName("device-3")).toBeUndefined();
  });
});
