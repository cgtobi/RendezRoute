// Posting rules and invite links (spec 7 Moderation; plan v1.0 step 3).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { type AdminDeps, logInAsAdmin } from "../../src/application/admin.ts";
import { createPlan } from "../../src/application/plans.ts";
import {
  confirmInvite,
  createInvite,
  listInvites,
  openInvite,
  revokeInvite,
} from "../../src/application/posting.ts";
import { mayCreatePlans } from "../../src/application/posting-rules.ts";
import { confirmTemplateLink } from "../../src/application/secret-links.ts";
import { saveAsTemplate, repeatTemplate } from "../../src/application/templates.ts";
import { FakeAdminAuth } from "../fakes/admin-auth.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: AdminDeps;
let clock: FakeClock;
let session: string;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;
const ZONE = "Europe/Berlin";

beforeEach(() => {
  clock = new FakeClock(fixtureNow);
  deps = {
    ...createFakeRepositories(),
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "invite",
    adminAuth: new FakeAdminAuth("the-admin-token"),
  };
  logIn();
});

/** A new admin session; one lasts 12 hours. */
function logIn() {
  const loggedIn = logInAsAdmin(deps, { token: "the-admin-token" });
  if (loggedIn.kind !== "logged_in") throw new Error("login failed");
  session = loggedIn.session.value;
}

async function newInvite(choices: { expiresOn?: string; maxUses?: string } = {}) {
  const created = await createInvite(deps, {
    session,
    expiresOn: choices.expiresOn ?? "",
    maxUses: choices.maxUses ?? "",
    timeZone: ZONE,
    nonce: nonce(),
  });
  if (created.kind !== "created") throw new Error(`invite not created: ${created.kind}`);
  return created.token;
}

/** Opens and confirms an invite link; returns the device token it leaves on the device. */
async function useInvite(token: string, deviceToken?: string) {
  const confirmed = await confirmInvite(deps, { token, deviceToken });
  if (confirmed.kind !== "allowed") throw new Error(`invite refused: ${confirmed.kind}`);
  return confirmed.newDeviceToken ?? deviceToken;
}

const create = (deviceToken: string | undefined) =>
  createPlan(deps, {
    input: sampleInput,
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });

/** The admin's invite list. */
async function invites() {
  const listed = await listInvites(deps, { session });
  if (listed.kind !== "invites") throw new Error("not admin");
  return listed.invites;
}

const devices = () => (deps.devices as ReturnType<typeof createFakeRepositories>["devices"]).all();

describe("posting rules (spec 7 Moderation)", () => {
  it("let anyone create plans with POSTING_MODE=anyone", async () => {
    deps.postingMode = "anyone";
    expect(await mayCreatePlans(deps, { deviceToken: undefined })).toBe(true);
    expect((await create(undefined)).kind).toBe("created");
  });

  it("with POSTING_MODE=invite, refuse devices that opened no invite link, without creating a device", async () => {
    expect(await mayCreatePlans(deps, { deviceToken: undefined })).toBe(false);
    expect(await create(undefined)).toEqual({ kind: "not_allowed", needs: "invite" });
    expect(await create("unknown-device-token")).toEqual({ kind: "not_allowed", needs: "invite" });
    expect(devices()).toEqual([]);
  });

  it("still answer a form sent again with its plan, and refuse malformed ones first", async () => {
    deps.postingMode = "anyone";
    const creationNonce = nonce();
    const first = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce,
      deviceToken: undefined,
    });
    if (first.kind !== "created") throw new Error("setup failed");
    deps.postingMode = "invite";
    const again = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce,
      deviceToken: undefined,
    });
    expect(again).toEqual({ kind: "duplicate", planId: first.planId });
    const malformed = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: "short",
      deviceToken: undefined,
    });
    expect(malformed).toEqual({ kind: "bad_request" });
  });

  it("let a device create plans once it opened a valid invite link", async () => {
    const deviceToken = await useInvite(await newInvite());
    expect(await mayCreatePlans(deps, { deviceToken })).toBe(true);
    expect((await create(deviceToken)).kind).toBe("created");
  });

  it("also apply to repeating a template", async () => {
    const deviceToken = await useInvite(await newInvite());
    const created = await create(deviceToken);
    if (created.kind !== "created") throw new Error("setup failed");
    const saved = await saveAsTemplate(deps, {
      planId: created.planId,
      deviceToken,
      includePrivate: false,
      creationNonce: nonce(),
    });
    if (saved.kind !== "saved") throw new Error(`template not saved: ${saved.kind}`);
    const repeat = (token: string | undefined) =>
      repeatTemplate(deps, {
        templateId: saved.templateId,
        deviceToken: token,
        date: "2026-06-14",
        time: "08:00",
        units: "metric",
        creationNonce: nonce(),
      });
    expect((await repeat(deviceToken)).kind).toBe("created");
    // A device linked to the template through its template link, but never invited.
    const other = await confirmTemplateLinkFor(saved.hostToken);
    expect(await repeat(other)).toEqual({ kind: "not_allowed", needs: "invite" });
  });
});

async function confirmTemplateLinkFor(templateLink: string) {
  const linked = await confirmTemplateLink(deps, { token: templateLink, deviceToken: undefined });
  if (linked.kind !== "linked") throw new Error("template link failed");
  return linked.newDeviceToken;
}

describe("invite links (spec 7 Moderation, decision D1)", () => {
  it("change nothing when opened: a confirmation first, no device, no use counted", async () => {
    const token = await newInvite({ maxUses: "1" });
    expect(await openInvite(deps, { token, deviceToken: undefined })).toEqual({ kind: "confirm" });
    expect(await openInvite(deps, { token, deviceToken: undefined })).toEqual({ kind: "confirm" });
    expect(devices()).toEqual([]);
    expect((await invites())[0]?.uses).toBe(0);
    expect(await openInvite(deps, { token: "unknown", deviceToken: undefined })).toEqual({
      kind: "invalid",
    });
  });

  it("lead a device that may already post straight on, without using the invite again", async () => {
    const token = await newInvite({ maxUses: "2" });
    const deviceToken = await useInvite(token);
    expect(await openInvite(deps, { token, deviceToken })).toEqual({ kind: "already_allowed" });
    expect(await confirmInvite(deps, { token, deviceToken })).toEqual({
      kind: "allowed",
      newDeviceToken: undefined,
    });
    expect((await invites())[0]?.uses).toBe(1);
  });

  it("that cannot be used answer the same to a device that may already post as to an unknown one", async () => {
    const deviceToken = await useInvite(await newInvite());
    const usedUp = await newInvite({ maxUses: "1" });
    await useInvite(usedUp);
    for (const token of [usedUp, "unknown"]) {
      expect(await openInvite(deps, { token, deviceToken })).toEqual({ kind: "invalid" });
      expect(await confirmInvite(deps, { token, deviceToken })).toEqual({ kind: "invalid" });
    }
  });

  it("keep no new device when another one took the last use a moment earlier (decision P2)", async () => {
    const token = await newInvite({ maxUses: "1" });
    const redeem = deps.invites.redeem.bind(deps.invites);
    // The other device confirms between this one's check and its redeeming.
    deps.invites.redeem = async (request) => {
      await redeem({ ...request, deviceId: "other-device", permissionId: "other" });
      return redeem(request);
    };
    expect(await confirmInvite(deps, { token, deviceToken: undefined })).toEqual({
      kind: "invalid",
    });
    expect(devices()).toEqual([]);
  });

  it("use an existing device rather than a new one", async () => {
    deps.postingMode = "anyone";
    const created = await create(undefined);
    if (created.kind !== "created") throw new Error("setup failed");
    deps.postingMode = "invite";
    const deviceToken = created.newDeviceToken;
    const confirmed = await confirmInvite(deps, { token: await newInvite(), deviceToken });
    expect(confirmed).toEqual({ kind: "allowed", newDeviceToken: undefined });
    expect(devices()).toHaveLength(1);
  });

  it("are refused once used up, expired or revoked, and create no device then", async () => {
    const usedUp = await newInvite({ maxUses: "1" });
    await useInvite(usedUp);
    const expiring = await newInvite({ expiresOn: "2026-06-02" });
    const revoked = await newInvite();
    const revokedId = (await invites())[0]?.id ?? "";
    expect(await revokeInvite(deps, { session, inviteId: revokedId })).toEqual({ kind: "revoked" });
    clock.set("2026-06-02T22:00:00Z"); // midnight in Berlin: the expiry day is over
    logIn();

    for (const token of [usedUp, expiring, revoked]) {
      expect(await openInvite(deps, { token, deviceToken: undefined })).toEqual({
        kind: "invalid",
      });
      expect(await confirmInvite(deps, { token, deviceToken: undefined })).toEqual({
        kind: "invalid",
      });
    }
    expect(devices()).toHaveLength(1);
    const states = (await invites()).map((i) => i.state);
    expect(states).toEqual(["revoked", "expired", "used_up"]);
  });

  it("revoked later, leave the devices that used them allowed to post", async () => {
    const token = await newInvite();
    const deviceToken = await useInvite(token);
    const inviteId = (await invites())[0]?.id ?? "";
    await revokeInvite(deps, { session, inviteId });
    expect(await mayCreatePlans(deps, { deviceToken })).toBe(true);
  });
});

describe("the admin's invite links (spec 7 Moderation)", () => {
  it("need the admin session", async () => {
    const request = { expiresOn: "", maxUses: "", timeZone: ZONE, nonce: nonce() };
    expect(await createInvite(deps, { ...request, session: undefined })).toEqual({
      kind: "not_admin",
    });
    expect(await createInvite(deps, { ...request, session: "forged" })).toEqual({
      kind: "not_admin",
    });
    expect(await listInvites(deps, { session: undefined })).toEqual({ kind: "not_admin" });
    expect(await revokeInvite(deps, { session: undefined, inviteId: "x" })).toEqual({
      kind: "not_admin",
    });
  });

  it("are created with optional expiry and usage limit, and listed newest first with their state", async () => {
    await newInvite();
    await newInvite({ expiresOn: "2026-06-10", maxUses: "20" });
    expect(await invites()).toEqual([
      {
        id: expect.any(String),
        expiresAt: new Date("2026-06-10T22:00:00Z"),
        maxUses: 20,
        uses: 0,
        revokedAt: undefined,
        createdAt: fixtureNow,
        state: "usable",
      },
      expect.objectContaining({ expiresAt: undefined, maxUses: undefined, state: "usable" }),
    ]);
  });

  it("are created once per form, and the form's errors are given back", async () => {
    const request = { session, expiresOn: "", maxUses: "", timeZone: ZONE, nonce: nonce() };
    expect((await createInvite(deps, request)).kind).toBe("created");
    expect(await createInvite(deps, request)).toEqual({ kind: "duplicate" });
    expect(await createInvite(deps, { ...request, nonce: "short" })).toEqual({
      kind: "bad_request",
    });
    expect(
      await createInvite(deps, { ...request, nonce: nonce(), expiresOn: "2026-05-01" }),
    ).toEqual({ kind: "invalid", errors: [{ field: "expiresOn", code: "expiry_in_past" }] });
    expect(await invites()).toHaveLength(1);
  });

  it("revoking an unknown invite says so", async () => {
    expect(await revokeInvite(deps, { session, inviteId: "unknown" })).toEqual({
      kind: "not_found",
    });
  });
});
