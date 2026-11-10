// An account's own data: listing, export, deletion and expiry (spec 3.7, 3.10; plan v1.0 step 5b;
// decision D25).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  deleteAccount,
  exportAccountData,
  expireAccounts,
  viewAccountData,
} from "../../src/application/account-data.ts";
import {
  type AccountDeps,
  claimDeviceData,
  finishLogin,
  startLogin,
} from "../../src/application/accounts.ts";
import { exportMyData } from "../../src/application/my-data.ts";
import { subscribe } from "../../src/application/channels.ts";
import { resolveDevice } from "../../src/application/devices.ts";
import { createPlan, viewPlan } from "../../src/application/plans.ts";
import type { ProviderAccount } from "../../src/application/ports.ts";
import { confirmInvite, createInvite } from "../../src/application/posting.ts";
import { respond } from "../../src/application/responses.ts";
import { saveAsTemplate } from "../../src/application/templates.ts";
import { runHousekeeping } from "../../src/application/maintenance.ts";
import { logInAsAdmin } from "../../src/application/admin.ts";
import { FakeAdminAuth } from "../fakes/admin-auth.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakeIdentityProvider } from "../fakes/identity-provider.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: AccountDeps;
let repositories: ReturnType<typeof createFakeRepositories>;
let provider: FakeIdentityProvider;
let clock: FakeClock;
let jobs: FakeJobQueue;
let channels: FakeChannelRepository;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;
const anna: ProviderAccount = { subject: "https://id.example.org anna", names: ["Anna R."] };
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  provider = new FakeIdentityProvider();
  repositories = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  jobs = new FakeJobQueue();
  channels = new FakeChannelRepository();
  deps = {
    ...repositories,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    identityLookup: { hash: (value) => `hmac(${value})` },
    identityProviders: { oidc: provider },
    fediverse: { servers: undefined, allowInsecure: false },
    notify: { channels, jobs, reminders: new FakeSentReminders() },
  };
});

async function logIn(account = anna, deviceToken?: string) {
  const started = await startLogin(deps, { provider: "oidc" });
  if (started.kind !== "redirect") throw new Error("not started");
  const done = await finishLogin(deps, {
    provider: "oidc",
    callback: provider.approve(started.authorizationUrl, account),
    cookieState: started.state,
    deviceToken,
  });
  if (done.kind !== "logged_in") throw new Error("login failed");
  return done.newDeviceToken;
}

async function newPlan(deviceToken: string | undefined, title: string) {
  const created = await createPlan(deps, {
    input: { ...sampleInput, title, posterName: "Host" },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (created.kind !== "created") throw new Error(`not created: ${created.kind}`);
  return created;
}

async function join(planId: string, deviceToken: string | undefined, name: string) {
  const responded = await respond(deps, {
    planId,
    choice: "joined",
    displayName: name,
    requestNote: "",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (responded.kind !== "created") throw new Error(`no response: ${responded.kind}`);
  return responded;
}

/** An account with a plan Carla joined, a response to Ben's plan and a template. */
async function accountWithData() {
  const phone = await logIn();
  const hosted = await newPlan(phone, "Anna's run");
  const carla = await join(hosted.planId, undefined, "Carla");
  const bens = await newPlan(undefined, "Ben's ride");
  await join(bens.planId, phone, "Anna");
  const template = await saveAsTemplate(deps, {
    planId: hosted.planId,
    deviceToken: phone,
    includePrivate: false,
    creationNonce: nonce(),
  });
  if (template.kind !== "saved") throw new Error("no template");
  return { phone, hosted, carla, bens, templateId: template.templateId };
}

const sub = (name: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
});

describe("the account's data (spec 3.7)", () => {
  it("lists what the account owns, and when it is deleted unless used", async () => {
    const { phone } = await accountWithData();
    const viewed = await viewAccountData(deps, { deviceToken: phone });
    expect(viewed).toMatchObject({
      kind: "account",
      data: {
        hosted: [{ title: "Anna's run" }],
        responses: [{ title: "Ben's ride", responseKind: "joined" }],
        templates: [{ title: "Anna's run" }],
        deleteAt: new Date(fixtureNow.getTime() + 365 * DAY),
      },
    });
    expect(await viewAccountData(deps, { deviceToken: undefined })).toEqual({
      kind: "logged_out",
    });
  });

  it("is exported with the account itself, and nothing of the browser's own", async () => {
    const { phone } = await accountWithData();
    const browserOnly = await newPlan(undefined, "Browser plan");
    const loggedIn = await logIn(anna, browserOnly.newDeviceToken);
    const exported = await exportAccountData(deps, { deviceToken: loggedIn });
    if (exported.kind !== "found") throw new Error("not found");
    expect(exported.data.plans.map((plan) => [plan.role, plan.view.title])).toEqual([
      ["host", "Anna's run"],
      ["response", "Ben's ride"],
    ]);
    expect(exported.data.templates).toHaveLength(1);
    expect(exported.data.account).toEqual({
      provider: "oidc",
      subject: anna.subject,
      handle: undefined,
      displayName: "Anna R.",
      createdAt: fixtureNow,
      lastActiveAt: fixtureNow,
    });
    expect(await exportAccountData(deps, { deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
    expect(phone).not.toBe(loggedIn);
  });

  it("is exported as the account sees it, and the browser's export as the browser does (I52)", async () => {
    const plan = await newPlan(undefined, "Shared plan");
    const browser = (await join(plan.planId, undefined, "Anna on the phone")).newDeviceToken;
    await join(plan.planId, await logIn(), "Anna R.");
    const phone = await logIn(anna, browser);
    const ownName = (data: { plans: { view: unknown }[] }) =>
      data.plans.map(
        (entry) =>
          (entry.view as { ownResponse?: { displayName: string } }).ownResponse?.displayName,
      );
    const account = await exportAccountData(deps, { deviceToken: phone });
    if (account.kind !== "found") throw new Error("no account export");
    expect(ownName(account.data)).toEqual(["Anna R."]);
    const device = await exportMyData(deps, { deviceToken: phone, scope: { kind: "device" } });
    if (device.kind !== "found") throw new Error("no device export");
    expect(ownName(device.data)).toEqual(["Anna on the phone"]);
  });
});

describe("export scopes (decision I52)", () => {
  it("export a browser that responded alone to an account's own plan as a responder, not as the host", async () => {
    const accountPlan = await newPlan(await logIn(), "Anna's run");
    const browser = (await join(accountPlan.planId, undefined, "Anna on the phone")).newDeviceToken;
    const phone = await logIn(anna, browser);
    const device = await exportMyData(deps, { deviceToken: phone, scope: { kind: "device" } });
    if (device.kind !== "found") throw new Error("no device export");
    expect(device.data.plans.map((plan) => plan.role)).toEqual(["response"]);
    const account = await exportAccountData(deps, { deviceToken: phone });
    if (account.kind !== "found") throw new Error("no account export");
    expect(account.data.plans.map((plan) => plan.role)).toEqual(["host"]);
  });

  it("export the account's own permission to post", async () => {
    deps.postingMode = "invite";
    const admin = { ...deps, adminAuth: new FakeAdminAuth("token") };
    const session = logInAsAdmin(admin, { token: "token" });
    if (session.kind !== "logged_in") throw new Error("no admin");
    const invite = await createInvite(admin, {
      session: session.session.value,
      expiresOn: "",
      maxUses: "",
      timeZone: "UTC",
      nonce: nonce(),
    });
    if (invite.kind !== "created") throw new Error("no invite");
    const phone = await logIn();
    await confirmInvite(deps, { token: invite.token, deviceToken: phone });
    const exported = await exportAccountData(deps, { deviceToken: phone });
    expect(exported).toMatchObject({ kind: "found", data: { mayPostSince: fixtureNow } });
    expect(await viewAccountData(deps, { deviceToken: phone })).toMatchObject({
      data: { mayPostSince: fixtureNow },
    });
  });
});

describe("deleting an account (spec 3.7; decision D25)", () => {
  it("Claiming moves a device's plans, responses and templates into the account, and account deletion removes everything linked to it", async () => {
    const { phone, hosted, carla, bens, templateId } = await accountWithData();
    // A browser's plan, claimed into the account, goes too.
    const claimedPlan = await newPlan(undefined, "Claimed plan");
    const claiming = await logIn(anna, claimedPlan.newDeviceToken);
    expect(await claimDeviceData(deps, { deviceToken: claiming })).toMatchObject({
      moved: { plans: 1 },
    });
    // A browser-only plan on a device that logs in later stays: it was never claimed.
    const browserOnly = await newPlan(undefined, "Browser plan");
    const laptop = await logIn(anna, browserOnly.newDeviceToken);
    // Ben's account and plan stay.
    const bensPhone = await logIn({ subject: "ben", names: ["Ben"] });
    const bensOwn = await newPlan(bensPhone, "Ben's own run");
    // The account may post through an invite.
    deps.postingMode = "invite";
    const admin = { ...deps, adminAuth: new FakeAdminAuth("token") };
    const session = logInAsAdmin(admin, { token: "token" });
    if (session.kind !== "logged_in") throw new Error("no admin");
    const invite = await createInvite(admin, {
      session: session.session.value,
      expiresOn: "",
      maxUses: "",
      timeZone: "UTC",
      nonce: nonce(),
    });
    if (invite.kind !== "created") throw new Error("no invite");
    await confirmInvite(deps, { token: invite.token, deviceToken: phone });
    // Carla follows the plan by push.
    await subscribe(deps, {
      planId: hosted.planId,
      deviceToken: carla.newDeviceToken,
      role: "responder",
      subscription: sub("carla"),
    });

    expect(await deleteAccount(deps, { deviceToken: laptop })).toEqual({ kind: "deleted" });
    // The account's plan is gone for everyone, Carla told; its response to Ben's plan withdrawn.
    expect((await viewPlan(deps, { planId: hosted.planId, deviceToken: undefined })).kind).toBe(
      "not_found",
    );
    expect([...jobs.jobs.values()].map((job) => job.payload)).toEqual([
      expect.objectContaining({ notification: expect.objectContaining({ kind: "deleted" }) }),
    ]);
    expect(await deps.responses.listByPlan(bens.planId)).toEqual([]);
    expect(await deps.templates.findById(templateId)).toBeUndefined();
    expect(
      (await viewPlan(deps, { planId: claimedPlan.planId, deviceToken: undefined })).kind,
    ).toBe("not_found");
    expect((await viewPlan(deps, { planId: bensOwn.planId, deviceToken: bensPhone })).kind).toBe(
      "poster",
    );
    expect(repositories.identities.all().map((identity) => identity.subject)).toEqual(["ben"]);
    // Its devices are logged out and keep only their own data.
    expect((await viewPlan(deps, { planId: browserOnly.planId, deviceToken: laptop })).kind).toBe(
      "poster",
    );
    expect((await device(laptop)).identityId).toBeUndefined();
    expect((await device(bensPhone)).identityId).toBeDefined();
    expect(await deps.permissions.mayPostSince((await device(phone)).id)).toBeUndefined();
  });

  it("needs a logged-in browser", async () => {
    expect(await deleteAccount(deps, { deviceToken: undefined })).toEqual({ kind: "logged_out" });
  });
});

describe("account expiry (spec 3.10)", () => {
  it("deletes accounts unused for 12 months with what they own, and counts device use as use", async () => {
    const idle = await logIn({ subject: "idle", names: ["Idle"] });
    const idlePlan = await newPlan(idle, "Idle plan");
    const busy = await logIn({ subject: "busy", names: ["Busy"] });
    // A year later the busy account's device is used once more; the idle one is not.
    clock.set(new Date(fixtureNow.getTime() + 364 * DAY));
    await resolveDevice(deps, busy);
    clock.set(new Date(fixtureNow.getTime() + 365 * DAY + 60_000));
    expect(await expireAccounts(deps)).toBe(1);
    expect(repositories.identities.all().map((identity) => identity.subject)).toEqual(["busy"]);
    expect(await deps.plans.findById(idlePlan.planId)).toBeUndefined();
  });

  it("keeps an account used after the list was made", async () => {
    const used = await logIn();
    const [stale] = repositories.identities.all();
    if (stale === undefined) throw new Error("no account");
    clock.set(new Date(fixtureNow.getTime() + 366 * DAY));
    await resolveDevice(deps, used);
    deps.identities = { ...deps.identities, listUnusedBefore: async () => [stale] };
    expect(await expireAccounts(deps)).toBe(0);
    expect(repositories.identities.all()).toHaveLength(1);
  });

  it("runs in the daily housekeeping", async () => {
    await logIn();
    clock.set(new Date(fixtureNow.getTime() + 366 * DAY));
    const result = await runHousekeeping({
      ...deps,
      backups: { deleteOlderThan: async () => 0 },
    });
    expect(result.deletedAccounts).toBe(1);
    expect(repositories.identities.all()).toEqual([]);
  });
});

async function device(deviceToken: string | undefined) {
  const found = await deps.devices.findByTokenHash(deps.tokens.hash(deviceToken ?? ""));
  if (found === undefined) throw new Error("no device");
  return found;
}
