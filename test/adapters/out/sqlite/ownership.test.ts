// Account ownership in SQLite (spec 4, 7 Identity; plan v1.0 step 5a): owner columns, the
// device_access view and claiming.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { createCalendarFeedRepository } from "../../../../src/adapters/out/sqlite/calendar-feeds.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createIdentityRepository } from "../../../../src/adapters/out/sqlite/identities.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import { createChannelRepository } from "../../../../src/adapters/out/sqlite/channels.ts";
import type { ResponseKind } from "../../../../src/domain/response.ts";
import { createTemplateRepository } from "../../../../src/adapters/out/sqlite/templates.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";
import { templateFromPlan } from "../../../../src/domain/template.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const devices = () => createDeviceRepository(database);
const plans = () => createPlanRepository(database, cipher);
const responses = () =>
  createResponseRepository(database, cipher, createLookupHasher(randomBytes(32)));
const templates = () => createTemplateRepository(database, cipher);
const host = (planId: string) => ({ role: "host" as const, planId });

beforeEach(async () => {
  database = await openDatabase(":memory:");
  for (const id of ["phone", "laptop", "other"]) {
    await devices().create({ id, tokenHash: `hash-${id}`, now: fixtureNow });
  }
  for (const id of ["anna", "ben"]) {
    await createIdentityRepository(database, cipher).create(
      {
        id,
        provider: "oidc",
        subject: `subject-${id}`,
        handle: undefined,
        displayName: undefined,
        createdAt: fixtureNow,
        lastActiveAt: fixtureNow,
      },
      `hash-${id}`,
    );
  }
});
afterEach(async () => {
  await database.close();
});

async function plan(id: string, owner?: string, hostDevice = "phone") {
  await plans().create({
    plan: samplePlan({ id }),
    hostTokenHash: `host-${id}`,
    creationNonce: `nonce-${id}`,
    hostDeviceId: hostDevice,
    ownerIdentityId: owner,
  });
}

describe("account ownership (step 5a)", () => {
  it("gives an account's plan to every device logged in to it, and to no other", async () => {
    await plan("owned", "anna");
    const links = database.sqlite.prepare("select count(*) from device_links").pluck();
    expect(links.get()).toBe(0);
    expect(await devices().hasLink("phone", host("owned"))).toBe(false);
    await devices().setIdentity("phone", "anna");
    await devices().setIdentity("laptop", "anna");
    await devices().setIdentity("other", "ben");
    expect(await devices().hasLink("phone", host("owned"))).toBe(true);
    expect(await devices().hasLink("laptop", host("owned"))).toBe(true);
    expect(await devices().hasLink("other", host("owned"))).toBe(false);
    await devices().setIdentity("laptop", undefined);
    expect(await devices().hasLink("laptop", host("owned"))).toBe(false);
  });

  it("lists a device's plans with or without its account's, each once", async () => {
    await plan("own");
    await plan("owned", "anna");
    await devices().setIdentity("phone", "anna");
    const ids = async (scope: "device" | "device_and_account") =>
      (await plans().findLinkedToDevice("phone", scope)).map((entry) => entry.plan.id).sort();
    expect(await ids("device")).toEqual(["own"]);
    expect(await ids("device_and_account")).toEqual(["own", "owned"]);
    // Linked and owned at once: still listed once.
    await devices().link("phone", host("owned"), fixtureNow);
    expect(await ids("device_and_account")).toEqual(["own", "owned"]);
  });

  it("finds an account's response on any of its devices", async () => {
    await plan("p");
    await responses().create({
      response: {
        id: "r",
        planId: "p",
        kind: "joined",
        displayName: "Anna",
        language: "en",
        previousKind: undefined,
        createdAt: fixtureNow,
        updatedAt: fixtureNow,
      },
      manageTokenHash: "manage-r",
      creationNonce: "nonce-r",
      deviceId: "other",
      identityId: "anna",
    });
    expect(await responses().findForDevice("p", "laptop")).toBeUndefined();
    await devices().setIdentity("laptop", "anna");
    expect((await responses().findForDevice("p", "laptop"))?.id).toBe("r");
    const row = database.sqlite.prepare("select device_id from responses").pluck().get();
    expect(row).toBe("other");
  });

  it("gives a template of an account's plan to the account", async () => {
    await plan("owned", "anna");
    await templates().create({
      template: templateFromPlan(samplePlan({ id: "owned" }), {
        id: "t",
        includePrivate: false,
        now: fixtureNow,
      }),
      hostTokenHash: "template-hash",
      route: undefined,
      hostsOfPlan: "owned",
    });
    await devices().setIdentity("laptop", "anna");
    expect(
      (await templates().listForDevice("laptop", "device_and_account")).map((t) => t.id),
    ).toEqual(["t"]);
    expect(await templates().listForDevice("laptop", "device")).toEqual([]);
  });

  it("keeps the calendar feed of a device whose account holds plans", async () => {
    const feeds = createCalendarFeedRepository(database);
    await feeds.replace({
      id: "feed",
      deviceId: "laptop",
      tokenHash: "feed-hash",
      language: "en",
      createdAt: fixtureNow,
      identityId: undefined,
    });
    await plan("owned", "anna");
    await devices().setIdentity("laptop", "anna");
    expect(await feeds.deleteUnlinked()).toBe(0);
    await devices().setIdentity("laptop", undefined);
    expect(await feeds.deleteUnlinked()).toBe(1);
  });
});

describe("Sign out all other devices on an account's plan (spec 3.2)", () => {
  it("removes other devices' links when the keeping device reaches the plan through its account", async () => {
    await plan("owned", "anna");
    await devices().link("other", host("owned"), fixtureNow);
    await devices().setIdentity("phone", "anna");
    expect(await devices().unlinkOthers(host("owned"), "phone")).toBe(1);
    expect(await devices().hasLink("other", host("owned"))).toBe(false);
    expect(await devices().hasLink("phone", host("owned"))).toBe(true);
  });
});

describe("claiming (spec 7 Identity)", () => {
  it("moves the device's own unowned items into the account, keeping other devices' links", async () => {
    await plan("mine");
    await plan("bens", "ben");
    await devices().link("phone", host("bens"), fixtureNow);
    await devices().link("other", host("mine"), fixtureNow);
    await devices().setIdentity("phone", "anna");
    expect(await devices().claimable("phone")).toEqual({ plans: 1, responses: 0, templates: 0 });
    expect(await devices().claimInto("phone", "anna")).toEqual({
      plans: 1,
      responses: 0,
      templates: 0,
    });
    const owners = database.sqlite
      .prepare("select id, owner_identity_id from plans order by id")
      .all();
    expect(owners).toEqual([
      { id: "bens", owner_identity_id: "ben" },
      { id: "mine", owner_identity_id: "anna" },
    ]);
    const links = database.sqlite
      .prepare("select device_id, plan_id from device_links order by device_id, plan_id")
      .all();
    expect(links).toEqual([
      { device_id: "other", plan_id: "mine" },
      { device_id: "phone", plan_id: "bens" },
    ]);
    expect(await devices().claimable("phone")).toEqual({ plans: 0, responses: 0, templates: 0 });
  });
});

async function response(
  id: string,
  planId: string,
  holder: { deviceId: string; identityId?: string },
  kind: ResponseKind = "joined",
  minutes = 0,
) {
  const at = new Date(fixtureNow.getTime() + minutes * 60_000);
  await responses().create({
    response: {
      id,
      planId,
      kind,
      displayName: id,
      language: "en",
      previousKind: undefined,
      createdAt: at,
      updatedAt: at,
    },
    manageTokenHash: `manage-${id}`,
    creationNonce: `nonce-${id}`,
    deviceId: holder.deviceId,
    identityId: holder.identityId,
  });
}

describe("one role per plan for an account (spec 3.2, 3.5)", () => {
  it("finds the device's own response before its account's", async () => {
    await plan("p", undefined, "other");
    await response("accounts", "p", { deviceId: "laptop", identityId: "anna" });
    await response("phones", "p", { deviceId: "phone" }, "joined", 5);
    await devices().setIdentity("phone", "anna");
    expect((await responses().findForDevice("p", "phone"))?.id).toBe("phones");
  });

  it("does not claim what would give the account a second role on a plan", async () => {
    await plan("annas", "anna", "other");
    await plan("shared", undefined, "other");
    await plan("phones");
    await response("to-annas", "annas", { deviceId: "phone" });
    await response("phone-to-shared", "shared", { deviceId: "phone" });
    await response("anna-to-shared", "shared", { deviceId: "laptop", identityId: "anna" });
    await response("anna-to-phones", "phones", { deviceId: "laptop", identityId: "anna" });
    await devices().setIdentity("phone", "anna");
    expect(await devices().claimable("phone")).toEqual({ plans: 0, responses: 0, templates: 0 });
    expect(await devices().claimInto("phone", "anna")).toEqual({
      plans: 0,
      responses: 0,
      templates: 0,
    });
  });

  it("claims nothing for an account the device is no longer logged in to", async () => {
    await plan("mine");
    await devices().setIdentity("phone", "ben");
    expect(await devices().claimInto("phone", "anna")).toEqual({
      plans: 0,
      responses: 0,
      templates: 0,
    });
    const owner = database.sqlite.prepare("select owner_identity_id from plans").pluck().get();
    expect(owner).toBeNull();
  });

  it("blocks a rejected or removed account on all its devices", async () => {
    await plan("p", undefined, "other");
    await response("removed", "p", { deviceId: "phone", identityId: "anna" }, "removed");
    expect(await responses().isBlocked("p", "laptop")).toBe(false);
    await devices().setIdentity("laptop", "anna");
    expect(await responses().isBlocked("p", "laptop")).toBe(true);
    expect(await responses().isBlocked("p", "phone")).toBe(true);
  });
});

describe("push subscriptions of a browser (step 5a)", () => {
  const channels = () =>
    createChannelRepository(
      database,
      cipher,
      { planId: () => "x", rowId: () => `c-${Math.random()}` },
      () => fixtureNow,
    );
  const sub = (name: string) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
  });

  it("are removed for the given items only, and go with the browser", async () => {
    await plan("a");
    await plan("b");
    await channels().add({ planId: "a" }, sub("phone-a"), "phone");
    await channels().add({ planId: "b" }, sub("phone-b"), "phone");
    await channels().add({ planId: "a" }, sub("laptop-a"), "laptop");
    await channels().removeForDevice("phone", [{ planId: "a" }]);
    const left = () =>
      database.sqlite
        .prepare("select plan_id, device_id from notification_channels order by plan_id")
        .all();
    expect(left()).toEqual([
      { plan_id: "a", device_id: "laptop" },
      { plan_id: "b", device_id: "phone" },
    ]);
    await devices().delete("phone");
    expect(left()).toEqual([{ plan_id: "a", device_id: "laptop" }]);
  });
});

describe("an account's own data (step 5b)", () => {
  it("lists the plans it owns and responded to, and its templates", async () => {
    await plan("owned", "anna");
    await plan("other", undefined, "other");
    await response("answer", "other", { deviceId: "phone", identityId: "anna" });
    await plan("not-annas");
    await templates().create({
      template: templateFromPlan(samplePlan({ id: "owned" }), {
        id: "t",
        includePrivate: false,
        now: fixtureNow,
      }),
      hostTokenHash: "template-hash",
      route: undefined,
      hostsOfPlan: "owned",
    });
    const owned = await plans().findOwnedBy("anna");
    expect(owned.map((entry) => [entry.role, entry.plan.id])).toEqual([
      ["host", "owned"],
      ["manage", "other"],
    ]);
    expect(owned[1]).toMatchObject({ responseId: "answer", responseKind: "joined" });
    expect((await templates().listOwnedBy("anna")).map((t) => t.id)).toEqual(["t"]);
    expect(await plans().findOwnedBy("ben")).toEqual([]);
  });

  it("counts a logged-in device's use as its account's", async () => {
    await devices().setIdentity("phone", "anna");
    const later = new Date(fixtureNow.getTime() + 60_000);
    await devices().touch("phone", later);
    await devices().touch("other", new Date(fixtureNow.getTime() + 120_000));
    const identities = createIdentityRepository(database, cipher);
    expect((await identities.findById("anna"))?.lastActiveAt).toEqual(later);
    expect((await identities.findById("ben"))?.lastActiveAt).toEqual(fixtureNow);
  });

  it("deletes the account, logging its devices out and taking its permissions", async () => {
    const identities = createIdentityRepository(database, cipher);
    await devices().setIdentity("phone", "anna");
    database.sqlite
      .prepare(
        "insert into permissions (id, identity_id, permission, created_at) values ('p', 'anna', 'may_post', 'x')",
      )
      .run();
    expect(
      (await identities.listUnusedBefore(new Date(fixtureNow.getTime() + 1))).map((i) => i.id),
    ).toEqual(["anna", "ben"]);
    await identities.delete("anna");
    expect(await identities.findById("anna")).toBeUndefined();
    expect((await devices().findByTokenHash("hash-phone"))?.identityId).toBeUndefined();
    expect(database.sqlite.prepare("select count(*) from permissions").pluck().get()).toBe(0);
  });
});

describe("access scopes (decision I52)", () => {
  it("read the device's own links, its account's items, or both", async () => {
    await plan("owned", "anna", "other");
    await plan("own");
    await response("accounts", "own", { deviceId: "laptop", identityId: "anna" });
    await devices().setIdentity("phone", "anna");
    expect(await devices().hasLink("phone", host("owned"), "account")).toBe(true);
    expect(await devices().hasLink("phone", host("owned"), "device")).toBe(false);
    expect(await devices().hasLink("phone", host("own"), "account")).toBe(false);
    expect(await devices().hasLink("phone", host("own"), "device")).toBe(true);
    expect((await responses().findForDevice("own", "phone", "account"))?.id).toBe("accounts");
    expect(await responses().findForDevice("own", "phone", "device")).toBeUndefined();
    expect(
      (await plans().findLinkedToDevice("phone", "account")).map((e) => e.plan.id).sort(),
    ).toEqual(["owned", "own"].sort());
  });
});
