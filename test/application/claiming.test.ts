// Plans, responses and templates in an account (spec 7 Identity; plan v1.0 step 5a; user decisions
// 2026-11-10: claiming only on request, new items belong to the account).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type AccountDeps,
  claimDeviceData,
  finishLogin,
  logOut,
  previewClaim,
  startLogin,
  viewAccount,
} from "../../src/application/accounts.ts";
import { createCalendarFeed, readCalendarFeed } from "../../src/application/calendar.ts";
import { deleteMyData, viewMyData } from "../../src/application/my-data.ts";
import { createPlan, viewPlan } from "../../src/application/plans.ts";
import type { ProviderAccount } from "../../src/application/ports.ts";
import { respond } from "../../src/application/responses.ts";
import { confirmHostLink } from "../../src/application/secret-links.ts";
import { listTemplates, saveAsTemplate } from "../../src/application/templates.ts";
import { removePerson } from "../../src/application/host.ts";
import { getNewLink } from "../../src/application/links.ts";
import { subscribe } from "../../src/application/channels.ts";
import { runRetentionSweep } from "../../src/application/maintenance.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakeIdentityProvider } from "../fakes/identity-provider.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: AccountDeps;
let provider: FakeIdentityProvider;
let channels: FakeChannelRepository;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;
const anna: ProviderAccount = { subject: "https://id.example.org anna", names: ["Anna"] };
const ben: ProviderAccount = { subject: "https://id.example.org ben", names: ["Ben"] };

beforeEach(() => {
  provider = new FakeIdentityProvider();
  channels = new FakeChannelRepository();
  deps = {
    ...createFakeRepositories(),
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock: new FakeClock(fixtureNow),
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    identityLookup: { hash: (value) => `hmac(${value})` },
    identityProviders: { oidc: provider },
    fediverse: { servers: undefined, allowInsecure: false },
    notify: { channels, jobs: new FakeJobQueue(), reminders: new FakeSentReminders() },
  };
});

/** Logs the device in (a new one when undefined); returns its token afterwards. */
async function logIn(account: ProviderAccount, deviceToken?: string) {
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

async function newPlan(deviceToken: string | undefined, title = "Morning run") {
  const created = await createPlan(deps, {
    input: { ...sampleInput, title },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (created.kind !== "created") throw new Error(`plan not created: ${created.kind}`);
  return created;
}

async function join(planId: string, deviceToken: string | undefined, name = "Carla") {
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

const audience = async (planId: string, deviceToken: string | undefined) =>
  (await viewPlan(deps, { planId, deviceToken })).kind;

describe("claiming (spec 7 Identity)", () => {
  it("moves a browser's plans, responses and templates into the account on request", async () => {
    // A browser that was never logged in: a plan, a response to another plan, a template.
    const hosted = await newPlan(undefined);
    const phone = hosted.newDeviceToken;
    const other = await newPlan(undefined, "Other plan");
    await join(other.planId, phone);
    const saved = await saveAsTemplate(deps, {
      planId: hosted.planId,
      deviceToken: phone,
      includePrivate: false,
      creationNonce: nonce(),
    });
    expect(saved.kind).toBe("saved");

    // Logging in moves nothing; the account page offers the move.
    const loggedIn = await logIn(anna, phone);
    expect(await viewAccount(deps, { deviceToken: loggedIn })).toMatchObject({
      claimable: { plans: 1, responses: 1, templates: 1 },
    });
    const laptop = await logIn(anna);
    expect(await audience(hosted.planId, laptop)).toBe("viewer");

    expect(await claimDeviceData(deps, { deviceToken: loggedIn })).toEqual({
      kind: "claimed",
      moved: { plans: 1, responses: 1, templates: 1 },
    });
    // Now every device logged in to the account has them.
    expect(await audience(hosted.planId, laptop)).toBe("poster");
    expect(await audience(other.planId, laptop)).toBe("participant");
    expect((await listTemplates(deps, { deviceToken: laptop })).map((t) => t.title)).toEqual([
      "Morning run",
    ]);
    expect(await viewAccount(deps, { deviceToken: loggedIn })).toMatchObject({
      claimable: { plans: 0, responses: 0, templates: 0 },
    });
    // Logged out, the phone no longer has them: they moved into the account.
    await logOut(deps, { deviceToken: loggedIn });
    expect(await audience(hosted.planId, loggedIn)).toBe("viewer");
  });

  it("lists what would move, and refuses a confirmation for a different number", async () => {
    const hosted = await newPlan(undefined, "Phone run");
    const phone = hosted.newDeviceToken;
    const other = await newPlan(undefined, "Other plan");
    await join(other.planId, phone);
    const stranger = await newPlan(undefined, "Stranger hike");
    const loggedIn = await logIn(anna, phone);

    const previewed = await previewClaim(deps, { deviceToken: loggedIn });
    if (previewed.kind !== "preview") throw new Error("expected a preview");
    expect(previewed.preview.total).toBe(2);
    expect(previewed.preview.hosted.map((item) => item.title)).toEqual(["Phone run"]);
    expect(previewed.preview.responses.map((item) => item.title)).toEqual(["Other plan"]);
    expect(stranger.planId).not.toBe(hosted.planId);

    // The person saw one item; the browser holds two: nothing moves.
    expect(await claimDeviceData(deps, { deviceToken: loggedIn, expected: 1 })).toEqual({
      kind: "changed",
    });
    expect(await viewAccount(deps, { deviceToken: loggedIn })).toMatchObject({
      claimable: { plans: 1, responses: 1, templates: 0 },
    });
    expect(await claimDeviceData(deps, { deviceToken: loggedIn, expected: 2 })).toMatchObject({
      kind: "claimed",
    });
    expect(await previewClaim(deps, { deviceToken: loggedIn })).toEqual({ kind: "nothing" });
    expect(await previewClaim(deps, { deviceToken: undefined })).toEqual({ kind: "logged_out" });
  });

  it("claims nothing of another device or account", async () => {
    const hosted = await newPlan(undefined);
    const phone = hosted.newDeviceToken;
    // A co-host on another browser, through the host link.
    const cohost = await confirmHostLink(deps, { token: hosted.hostToken, deviceToken: undefined });
    if (cohost.kind !== "linked") throw new Error("not linked");
    // Ben's plan, which Anna's browser co-hosts too.
    const bens = await newPlan(await logIn(ben), "Ben's plan");
    await confirmHostLink(deps, { token: bens.hostToken, deviceToken: phone });

    const annas = await logIn(anna, phone);
    expect(await claimDeviceData(deps, { deviceToken: annas })).toEqual({
      kind: "claimed",
      moved: { plans: 1, responses: 0, templates: 0 },
    });
    // The co-host keeps their own link; Ben's plan stays Ben's.
    expect(await audience(hosted.planId, cohost.newDeviceToken)).toBe("poster");
    const bensLaptop = await logIn(ben);
    expect(await audience(bens.planId, bensLaptop)).toBe("poster");
    const annasLaptop = await logIn(anna);
    expect(await audience(bens.planId, annasLaptop)).toBe("viewer");
  });

  it("needs a logged-in browser", async () => {
    const hosted = await newPlan(undefined);
    expect(await claimDeviceData(deps, { deviceToken: hosted.newDeviceToken })).toEqual({
      kind: "logged_out",
    });
    expect(await audience(hosted.planId, hosted.newDeviceToken)).toBe("poster");
  });
});

describe("what is created while logged in (user decision 2026-11-10)", () => {
  it("belongs to the account and reaches its other devices", async () => {
    const phone = await logIn(anna);
    const laptop = await logIn(anna);
    const hosted = await newPlan(phone);
    expect(await audience(hosted.planId, laptop)).toBe("poster");
    const other = await newPlan(undefined, "Other plan");
    await join(other.planId, laptop);
    expect(await audience(other.planId, phone)).toBe("participant");
    // Nothing is left to claim, and the account cannot respond to its own plan.
    expect(await viewAccount(deps, { deviceToken: phone })).toMatchObject({
      claimable: { plans: 0, responses: 0, templates: 0 },
    });
    const own = await respond(deps, {
      planId: hosted.planId,
      choice: "joined",
      displayName: "Anna",
      requestNote: "",
      language: "en",
      creationNonce: nonce(),
      deviceToken: laptop,
    });
    expect(own.kind).toBe("is_host");
  });

  it("templates of an account's plan belong to the account", async () => {
    const phone = await logIn(anna);
    const hosted = await newPlan(phone);
    await saveAsTemplate(deps, {
      planId: hosted.planId,
      deviceToken: phone,
      includePrivate: false,
      creationNonce: nonce(),
    });
    const laptop = await logIn(anna);
    expect(await listTemplates(deps, { deviceToken: laptop })).toHaveLength(1);
  });
});

describe("this browser's data (spec 3.7) next to the account's", () => {
  it("My data and Delete my data cover only what this browser holds itself", async () => {
    const phone = await logIn(anna);
    const accountPlan = await newPlan(phone, "Account plan");
    const browserOnly = await newPlan(undefined, "Browser plan");
    // The browser-only plan's device logs in later: its plan stays the browser's.
    const browser = await logIn(anna, browserOnly.newDeviceToken);
    const myData = await viewMyData(deps, { deviceToken: browser });
    expect(myData.hosted.map((item) => item.title)).toEqual(["Browser plan"]);
    await deleteMyData(deps, { deviceToken: browser });
    expect(await audience(browserOnly.planId, undefined)).toBe("not_found");
    expect(await audience(accountPlan.planId, phone)).toBe("poster");
  });
});

describe("one role per plan for an account (spec 3.2, 3.5)", () => {
  it("a browser's own response comes first, is the one Delete my data withdraws, and is not claimed next to the account's", async () => {
    const plan = await newPlan(undefined, "Shared plan");
    const browserAlone = (await join(plan.planId, undefined, "Anna on the phone")).newDeviceToken;
    const laptop = await logIn(anna);
    await join(plan.planId, laptop, "Anna on the laptop");
    const phone = await logIn(anna, browserAlone);
    const own = await deps.responses.findForDevice(plan.planId, (await device(phone)).id);
    expect(own?.displayName).toBe("Anna on the phone");
    expect(await viewAccount(deps, { deviceToken: phone })).toMatchObject({
      claimable: { responses: 0 },
    });
    await deleteMyData(deps, { deviceToken: phone });
    const left = await deps.responses.listByPlan(plan.planId);
    expect(left.map((response) => response.displayName)).toEqual(["Anna on the laptop"]);
  });

  it("claims no response to the account's own plan, and no plan the account responded to", async () => {
    const accountsPlan = await newPlan(await logIn(anna), "Anna's plan");
    const browser = (await join(accountsPlan.planId, undefined, "Anna again")).newDeviceToken;
    const hosted = await newPlan(browser, "Browser's plan");
    await join(hosted.planId, await logIn(anna), "Anna R.");
    const phone = await logIn(anna, browser);
    expect(await claimDeviceData(deps, { deviceToken: phone })).toEqual({
      kind: "claimed",
      moved: { plans: 0, responses: 0, templates: 0 },
    });
  });

  it("blocks a rejected or removed account on all its devices", async () => {
    const plan = await newPlan(undefined);
    const phone = await logIn(anna);
    await join(plan.planId, phone, "Anna R.");
    const [joined] = await deps.responses.listByPlan(plan.planId);
    await removePerson(deps, {
      planId: plan.planId,
      deviceToken: plan.newDeviceToken,
      responseId: joined?.id ?? "",
    });
    const laptop = await logIn(anna);
    const again = await respond(deps, {
      planId: plan.planId,
      choice: "joined",
      displayName: "Anna R.",
      requestNote: "",
      language: "en",
      creationNonce: nonce(),
      deviceToken: laptop,
    });
    expect(again.kind).toBe("blocked");
  });
});

describe("more of what is created while logged in", () => {
  it("templates saved while logged in belong to the account, even of the browser's own plan", async () => {
    const browserPlan = await newPlan(undefined, "Browser plan");
    const phone = await logIn(anna, browserPlan.newDeviceToken);
    await saveAsTemplate(deps, {
      planId: browserPlan.planId,
      deviceToken: phone,
      includePrivate: false,
      creationNonce: nonce(),
    });
    const laptop = await logIn(anna);
    expect((await listTemplates(deps, { deviceToken: laptop })).map((t) => t.title)).toEqual([
      "Browser plan",
    ]);
  });

  it("the retention sweep keeps an account plan's template in the account", async () => {
    const phone = await logIn(anna);
    const created = await createPlan(deps, {
      input: { ...sampleInput, keepAsTemplate: "1" },
      units: "metric",
      language: "en",
      creationNonce: nonce(),
      deviceToken: phone,
    });
    if (created.kind !== "created") throw new Error("not created");
    (deps.clock as FakeClock).set("2026-06-21T05:30:00Z");
    expect(await runRetentionSweep(deps)).toEqual({ deletedPlans: 1 });
    const laptop = await logIn(anna);
    expect(await listTemplates(deps, { deviceToken: laptop })).toHaveLength(1);
  });

  it("an account's device can get a new host link for an account plan", async () => {
    const phone = await logIn(anna);
    const plan = await newPlan(phone);
    const laptop = await logIn(anna);
    const issued = await getNewLink(deps, {
      kind: "host",
      id: plan.planId,
      deviceToken: laptop,
      formNonce: nonce(),
    });
    expect(issued.kind).toBe("issued");
  });
});

describe("logging out (spec 7 Identity: this device only)", () => {
  it("removes this browser's push subscriptions for the account's items, keeping its own", async () => {
    const own = await newPlan(undefined, "Browser plan");
    const phone = await logIn(anna, own.newDeviceToken);
    const accountPlan = await newPlan(phone, "Account plan");
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/phone",
      keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
    };
    for (const planId of [own.planId, accountPlan.planId]) {
      expect(
        await subscribe(deps, { planId, deviceToken: phone, role: "host", subscription: sub }),
      ).toEqual({ kind: "subscribed" });
    }
    await logOut(deps, { deviceToken: phone });
    expect(await channels.listFor({ planId: own.planId })).toHaveLength(1);
    expect(await channels.listFor({ planId: accountPlan.planId })).toEqual([]);
  });
});

describe("logging in to another account without logging out", () => {
  it("removes the first account's push subscriptions on that browser, keeping them on re-login", async () => {
    const carol: ProviderAccount = { subject: "https://id.example.org carol", names: ["Carol"] };
    const dave: ProviderAccount = { subject: "https://id.example.org dave", names: ["Dave"] };
    const browser = await logIn(carol);
    const hosted = await newPlan(browser, "Carol's plan");
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/kiosk",
      keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
    };
    expect(
      await subscribe(deps, {
        planId: hosted.planId,
        deviceToken: browser,
        role: "host",
        subscription: sub,
      }),
    ).toEqual({ kind: "subscribed" });
    const again = await logIn(carol, browser);
    expect(await channels.listFor({ planId: hosted.planId })).toHaveLength(1);
    await logIn(dave, again);
    expect(await channels.listFor({ planId: hosted.planId })).toEqual([]);
  });
});

describe("the calendar feed and logging in (decision D25)", () => {
  const titles = async (token: string) => {
    const feed = await readCalendarFeed(deps, { token });
    if (feed.kind !== "found") throw new Error("feed missing");
    return feed.entries.map((entry) => entry.title).sort();
  };
  const makeFeed = async (deviceToken: string | undefined) => {
    const created = await createCalendarFeed(deps, { deviceToken, language: "en" });
    if (created.kind !== "created") throw new Error(created.kind);
    return created.token;
  };

  it("does not list the plans of whoever logs in later on that browser", async () => {
    const secret = await newPlan(undefined, "Link-only plan");
    const alicePhone = await logIn(anna);
    await join(secret.planId, alicePhone, "Alice");
    const shared = await join((await newPlan(undefined, "Public plan")).planId, undefined, "Bob");
    const token = await makeFeed(shared.newDeviceToken);
    expect(await titles(token)).toEqual(["Public plan"]);
    await logIn(anna, shared.newDeviceToken);
    expect(await titles(token)).toEqual(["Public plan"]);
  });

  it("keeps listing the account's plans while the same account is logged in, not another", async () => {
    const phone = await logIn(anna);
    const own = await newPlan(undefined, "Own plan");
    const browser = await logIn(anna, own.newDeviceToken);
    await newPlan(phone, "Anna's plan");
    const token = await makeFeed(browser);
    expect(await titles(token)).toEqual(["Anna's plan", "Own plan"]);
    await newPlan(phone, "Anna's later plan");
    expect(await titles(token)).toEqual(["Anna's later plan", "Anna's plan", "Own plan"]);
    const other = await logIn(ben, browser);
    expect(await titles(token)).toEqual(["Own plan"]);
    await logIn(anna, other);
    expect(await titles(token)).toEqual(["Anna's later plan", "Anna's plan", "Own plan"]);
  });
});

async function device(deviceToken: string | undefined) {
  const found = await deps.devices.findByTokenHash(deps.tokens.hash(deviceToken ?? ""));
  if (found === undefined) throw new Error("no device");
  return found;
}
