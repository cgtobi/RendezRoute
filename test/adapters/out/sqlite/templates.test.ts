import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import { createTemplateRepository } from "../../../../src/adapters/out/sqlite/templates.ts";
import type { NewTemplate } from "../../../../src/application/ports.ts";
import { templateFromPlan } from "../../../../src/domain/template.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const templates = () => createTemplateRepository(database, cipher);
const plans = () => createPlanRepository(database, cipher);
const devices = () => createDeviceRepository(database);

const route = {
  segments: [
    [
      { lat: 48.1631, lng: 11.6014 },
      { lat: 48.17, lng: 11.61, ele: 520 },
    ],
  ],
};
const plan = samplePlan(
  { id: "plan-1", hasRoute: true },
  { exactDescription: "SENTINEL-exact", title: "Hill repeats" },
);

const kept = (overrides: Partial<NewTemplate> = {}): NewTemplate => ({
  template: templateFromPlan(plan, { id: "template-1", includePrivate: true, now: fixtureNow }),
  hostTokenHash: "template-hash",
  route,
  hostsOfPlan: "plan-1",
  ...overrides,
});

beforeEach(async () => {
  database = await openDatabase(":memory:");
  for (const id of ["device-1", "device-2", "device-3"]) {
    await devices().create({ id, tokenHash: id, now: fixtureNow });
  }
  await plans().create({
    plan,
    hostTokenHash: "host",
    creationNonce: "nonce",
    hostDeviceId: "device-1",
    route,
  });
  await devices().link("device-2", { role: "host", planId: "plan-1" }, fixtureNow);
  await createResponseRepository(database, cipher).create({
    response: {
      id: "response-1",
      planId: "plan-1",
      kind: "joined",
      displayName: "SENTINEL-name",
      language: "en",
      previousKind: undefined,
      createdAt: fixtureNow,
      updatedAt: fixtureNow,
    },
    manageTokenHash: "manage",
    creationNonce: "nonce-response",
    deviceId: "device-3",
  });
});
afterEach(async () => {
  await database.close();
});

const raw = () => JSON.stringify(database.sqlite.prepare("select * from plan_templates").all());

describe("SQLite templates (spec 3.10, section 4)", () => {
  it("store the template with its route, encrypted, and link the plan's host devices", async () => {
    await templates().create(kept());
    expect(await templates().findById("template-1")).toEqual(kept().template);
    expect(await templates().findByHostTokenHash("template-hash")).toMatchObject({
      id: "template-1",
    });
    expect(await templates().findRoute("template-1")).toEqual(route);
    expect(raw()).not.toContain("SENTINEL");
    expect(raw()).not.toContain("48.1631");
    for (const device of ["device-1", "device-2"]) {
      expect(await devices().hasLink(device, { role: "template", templateId: "template-1" })).toBe(
        true,
      );
    }
    expect(
      await devices().hasLink("device-3", { role: "template", templateId: "template-1" }),
    ).toBe(false);
    expect((await templates().listForDevice("device-2", "device")).map((t) => t.title)).toEqual([
      "Hill repeats",
    ]);
    expect(await templates().listForDevice("device-3", "device")).toEqual([]);
  });

  it("are kept in the same transaction as the plan's deletion, with nothing from responses", async () => {
    await plans().deleteMany(["plan-1"], [kept({ hostTokenHash: undefined })]);
    expect(await plans().findById("plan-1")).toBeUndefined();
    expect(await templates().findById("template-1")).toMatchObject({ title: "Hill repeats" });
    expect(
      await devices().hasLink("device-1", { role: "template", templateId: "template-1" }),
    ).toBe(true);
    const row = database.sqlite.prepare("select * from plan_templates").get();
    expect(JSON.stringify(row)).not.toContain("plan-1");
    expect(JSON.stringify(row)).not.toContain("SENTINEL-name");
  });

  it("are updated, lose their route, and are deleted with their links", async () => {
    await templates().create(kept());
    const later = new Date(fixtureNow.getTime() + 1000);
    const template = {
      ...kept().template,
      title: "Tempo",
      exactStart: undefined,
      updatedAt: later,
    };
    await templates().update(template);
    expect(await templates().findById("template-1")).toEqual(template);
    const used = new Date(fixtureNow.getTime() + 2000);
    const expires = new Date(fixtureNow.getTime() + 3000);
    await templates().markUsed("template-1", used, expires);
    expect(await templates().findById("template-1")).toEqual({
      ...template,
      lastUsedAt: used,
      expiresAt: expires,
      updatedAt: used,
    });
    await templates().deleteRoute("template-1");
    expect(await templates().findRoute("template-1")).toBeUndefined();
    expect(await templates().findById("template-1")).toMatchObject({ hasRoute: false });
    await templates().delete("template-1");
    expect(await templates().findById("template-1")).toBeUndefined();
    expect(
      database.sqlite
        .prepare("select count(*) as n from device_links where template_id is not null")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("are found by the one-time value of the form that made them", async () => {
    await templates().create(kept({ creationNonce: "nonce-template-0001" }));
    expect(await templates().findIdByCreationNonce("nonce-template-0001")).toBe("template-1");
    await expect(
      templates().create(
        kept({
          template: { ...kept().template, id: "template-2" },
          hostTokenHash: "other",
          creationNonce: "nonce-template-0001",
        }),
      ),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("get new link hashes, and sign out other devices (spec 3.2)", async () => {
    await templates().create(kept({ hostTokenHash: undefined }));
    await templates().setHostTokenHash("template-1", "new-template-hash");
    expect(await templates().findByHostTokenHash("new-template-hash")).toMatchObject({
      id: "template-1",
    });

    const target = { role: "template", templateId: "template-1" } as const;
    expect(await devices().unlinkOthers(target, "device-2")).toBe(1);
    expect(await devices().hasLink("device-1", target)).toBe(false);
    expect(await devices().hasLink("device-2", target)).toBe(true);
    // Other links of the same devices stay.
    expect(await devices().hasLink("device-1", { role: "host", planId: "plan-1" })).toBe(true);
  });

  it("expire when their date has passed", async () => {
    await templates().create(kept());
    const { expiresAt } = kept().template;
    expect(await templates().deleteExpired(new Date(expiresAt.getTime() - 1))).toBe(0);
    expect(await templates().deleteExpired(expiresAt)).toBe(1);
    expect(await templates().findById("template-1")).toBeUndefined();
  });

  it("keep devices linked only to a template from expiring as unlinked", async () => {
    await templates().create(kept());
    await plans().delete("plan-1");
    const later = new Date(fixtureNow.getTime() + 40 * 24 * 60 * 60 * 1000);
    await devices().deleteInactive({
      unlinkedLastSeenBefore: later,
      anyLastSeenBefore: fixtureNow,
    });
    expect(await templates().listForDevice("device-1", "device")).toHaveLength(1);
  });
});
