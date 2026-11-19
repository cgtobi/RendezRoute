// v0.7 acceptance criteria (spec 7, released as 0.7 by decision D21), one test named after each
// (spec 2b definition of done), through the web pages. "Nobody but the instance admin sees
// reports, …" runs across every audience and endpoint in test/privacy/plan-endpoints.test.ts.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { checkpoint } from "../../src/adapters/out/sqlite/database.ts";
import { translator } from "../../src/adapters/i18n/i18n.ts";
import { FakeOidcServer } from "../fakes/oidc-server.ts";
import { createTestApp } from "../support/app.ts";
import { hiddenFields, TestClient } from "../support/client.ts";
import { createPlanViaUi, planForm, respondViaUi } from "../support/plans.ts";

const en = translator("en");
const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');

const SENTINEL_TITLE = "SENTINEL-account-plan";
const SENTINEL_ACCOUNT = "SENTINEL-account-subject";
const PUSH_SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/v07-acceptance",
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup(env: Record<string, string> = {}, databasePath?: string) {
  const oidc = new FakeOidcServer();
  const test = await createTestApp({
    env: { ...oidc.env(), ADMIN_TOKEN, ...env },
    oidc,
    ...(databasePath === undefined ? {} : { databasePath }),
  });
  const client = () => new TestClient(test.app);
  /** A browser logged in as this person through the fake provider. */
  const logIn = async (browser: TestClient, sub: string) => {
    const start = new URL((await browser.get("/login/oidc")).headers.get("location") ?? "");
    const callback = oidc.approve(start, { sub, name: sub });
    await browser.get(`${callback.pathname}${callback.search}`);
  };
  return { ...test, client, logIn };
}

/** The instance admin's new invite link, as a path. */
async function inviteLink(admin: TestClient): Promise<string> {
  const login = hiddenFields(await (await admin.get("/admin/login")).text());
  await admin.postForm("/admin/login", { ...login, token: ADMIN_TOKEN });
  const home = await (await admin.get("/admin/")).text();
  const created = await admin.postForm("/admin/invites", {
    ...hiddenFields(home.slice(home.indexOf('id="invites"'))),
    expiresOn: "",
    maxUses: "",
  });
  const path = /https:\/\/runs\.example\.org(\/i\/[A-Za-z0-9_-]{43})/.exec(
    await created.text(),
  )?.[1];
  if (path === undefined) throw new Error("no invite link");
  return path;
}

const confirmInvite = async (browser: TestClient, path: string) =>
  browser.postForm("/i", hiddenFields(await (await browser.get(path)).text()));

/** Sends the create form from elsewhere, as a browser without the form would. */
async function forcedCreate(browser: TestClient) {
  const _csrf = hiddenFields(await (await browser.get("/")).text())._csrf ?? "";
  return browser.postForm("/new", { _csrf, nonce: "n".repeat(22), ...planForm() });
}

describe("v0.7 acceptance criteria (spec 7)", () => {
  it("With `POSTING_MODE=invite`, only devices or accounts that opened a valid invite link can create plans", async () => {
    const test = await setup({ POSTING_MODE: "invite" });
    const plans = () => test.database.sqlite.prepare("select count(*) from plans").pluck().get();

    // Without an invite: no plan, neither from the form page nor sent from elsewhere.
    const stranger = test.client();
    expect(text(await (await stranger.get("/new")).text())).toContain(en("posting.inviteNeeded"));
    expect((await forcedCreate(stranger)).status).toBe(403);

    // A device that opened a valid invite link can.
    const link = await inviteLink(test.client());
    const device = test.client();
    expect((await confirmInvite(device, link)).status).toBe(303);
    await createPlanViaUi(device);

    // An account that opened one, on any of its devices.
    const phone = test.client();
    await test.logIn(phone, "anna");
    await confirmInvite(phone, link);
    const laptop = test.client();
    await test.logIn(laptop, "anna");
    await createPlanViaUi(laptop);

    // An account that never opened one cannot, logged in or not.
    const ben = test.client();
    await test.logIn(ben, "ben");
    expect((await forcedCreate(ben)).status).toBe(403);

    // A revoked link opens nothing: the unused one is revoked, by its ID.
    const admin = test.client();
    const revoked = await inviteLink(admin);
    const unused = test.database.sqlite
      .prepare("select id from invites where uses = 0")
      .pluck()
      .get() as string;
    const home = await (await admin.get("/admin/")).text();
    const revokedNow = await admin.postForm(`/admin/invites/${unused}/revoke`, hiddenFields(home));
    expect(revokedNow.status).toBe(303);
    const late = test.client();
    expect((await confirmInvite(late, revoked)).status).toBe(404);
    expect((await forcedCreate(late)).status).toBe(403);
    expect(plans()).toBe(2);
  });

  it("Claiming moves a device's plans, responses and templates into the account, and account deletion removes everything linked to it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-v07-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");
    const test = await setup({ POSTING_MODE: "invite" }, path);
    const link = await inviteLink(test.client());
    // A browser that was never logged in: a plan, a response to Ben's plan, a template.
    const phone = test.client();
    await confirmInvite(phone, link);
    const { planId } = await createPlanViaUi(phone, { title: SENTINEL_TITLE });
    const benBrowser = test.client();
    await confirmInvite(benBrowser, link);
    const bens = await createPlanViaUi(benBrowser, { title: "Ben's ride", posterName: "Ben" });
    await respondViaUi(phone, bens.planId, "Anna", "joined");
    const hostPage = await (await phone.get(`/p/${planId}/host`)).text();
    await phone.postForm(
      `/p/${planId}/host/template`,
      hiddenFields(hostPage.slice(hostPage.indexOf(`action="/p/${planId}/host/template"`))),
    );

    // Claiming on the account page moves all three: the account has them, the browser itself not.
    await test.logIn(phone, SENTINEL_ACCOUNT);
    const account = text(await (await phone.get("/account")).text());
    expect(account).toContain(en("account.claimPlans", { count: 1 }));
    expect(account).toContain(en("account.claimResponses", { count: 1 }));
    expect(account).toContain(en("account.claimTemplates", { count: 1 }));
    const confirmation = text(await (await phone.get("/account/claim")).text());
    expect(confirmation).toContain(en("account.claimMove", { count: 3 }));
    await phone.postForm("/account/claim", hiddenFields(confirmation));
    const count = (sql: string) => test.database.sqlite.prepare(sql).pluck().get();
    expect(
      test.database.sqlite
        .prepare("select count(*) from device_links where plan_id = ?")
        .pluck()
        .get(planId),
    ).toBe(0);
    const laptop = test.client();
    await test.logIn(laptop, SENTINEL_ACCOUNT);
    expect((await laptop.get(`/p/${planId}/host`)).status).toBe(200);
    expect(await (await laptop.get(`/p/${bens.planId}`)).text()).toContain(
      `href="/p/${bens.planId}/me"`,
    );
    // The account may post through an invite, and follows Ben's plan by push.
    await confirmInvite(laptop, link);
    const csrf = hiddenFields(await (await laptop.get("/")).text())._csrf ?? "";
    const subscribed = await laptop.request(`/p/${bens.planId}/me/notifications`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ subscription: PUSH_SUBSCRIPTION }),
    });
    expect(subscribed.status).toBe(200);

    // Deleting the account removes everything linked to it; Ben's plan stays.
    const confirm = await (await laptop.get("/account/delete")).text();
    await laptop.postForm("/account/delete", hiddenFields(confirm));
    expect((await laptop.get(`/p/${planId}`)).status).toBe(404);
    for (const table of ["identities", "responses", "plan_templates", "notification_channels"]) {
      expect(count(`select count(*) from ${table}`)).toBe(0);
    }
    expect(count("select count(*) from permissions where identity_id is not null")).toBe(0);
    expect(count("select count(*) from devices where identity_id is not null")).toBe(0);
    expect(test.database.sqlite.prepare("select title from plans").pluck().all()).toEqual([
      "Ben's ride",
    ]);
    expect(text(await (await phone.get("/account")).text())).toContain(
      en("account.loginWith", { name: "Club login" }),
    );
    // Nothing of it is left in the database files either (spec 2b privacy tests).
    checkpoint(test.database);
    const raw = [path, `${path}-wal`]
      .filter(existsSync)
      .map((file) => readFileSync(file).toString("latin1"))
      .join("");
    expect(raw).not.toContain(SENTINEL_TITLE);
    expect(raw).not.toContain(SENTINEL_ACCOUNT);
    await test.database.close();
  });
});
