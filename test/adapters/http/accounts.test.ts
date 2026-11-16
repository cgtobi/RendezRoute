// Accounts through the web pages, with a fake OIDC provider (spec 7 Identity, 3.11 Account takeover;
// plan v1.0 step 4a).
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { isSecretLinkPath } from "../../../src/adapters/in/http/routes/secret-links.tsx";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, planForm } from "../../support/plans.ts";
import { FakeOidcServer, type FakeOidcUser } from "../../fakes/oidc-server.ts";

const en = translator("en");
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');
const anna: FakeOidcUser = { sub: "SENTINEL-sub-123", name: "Anna Example" };

async function setup(env: Record<string, string> = {}) {
  const oidc = new FakeOidcServer();
  const test = await createTestApp({ env: { ...oidc.env(), ...env }, oidc });
  return { ...test, oidc };
}

/** Starts a login; returns where the app sends the browser. */
async function startLogin(client: TestClient) {
  const started = await client.get("/login/oidc");
  expect(started.status).toBe(303);
  return new URL(started.headers.get("location") ?? "");
}

/** The browser's way back from the provider. */
const callbackPath = (callback: URL) => `${callback.pathname}${callback.search}`;

/** A whole login through the pages. */
async function logIn(client: TestClient, oidc: FakeOidcServer, user = anna) {
  const callback = oidc.approve(await startLogin(client), user);
  return client.get(callbackPath(callback));
}

const identities = (database: { sqlite: { prepare(sql: string): { all(): unknown[] } } }) =>
  database.sqlite.prepare("select * from identities").all();

describe("without a way to log in", () => {
  it("has no account pages and no account link", async () => {
    const { app } = await createTestApp();
    const client = new TestClient(app);
    expect((await client.get("/account")).status).toBe(404);
    expect((await client.get("/login/oidc")).status).toBe(404);
    expect((await client.get("/login/oidc/callback?code=x&state=y")).status).toBe(404);
    expect(await (await client.get("/")).text()).not.toContain('href="/account"');
  });
});

describe("logging in with OIDC (spec 7 Identity)", () => {
  it("goes from the account page to the provider and back, linking this browser to the account", async () => {
    const { app, oidc, database } = await setup();
    const client = new TestClient(app);
    expect(await (await client.get("/")).text()).toContain('href="/account"');
    const page = await client.get("/account");
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    const loginPage = text(await page.text());
    expect(loginPage).toContain(en("account.loginWith", { name: "Club login" }));
    expect(loginPage).toContain('href="/login/oidc"');

    const started = await client.get("/login/oidc");
    expect(started.status).toBe(303);
    expect(started.headers.get("cache-control")).toBe("no-store");
    const loginCookie = started.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Host-rr-login="));
    expect(loginCookie).toMatch(/; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    const authorizationUrl = new URL(started.headers.get("location") ?? "");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://runs.example.org/login/oidc/callback",
    );
    // Starting a login creates no device.
    expect(client.cookies.has("__Host-rr-device")).toBe(false);

    const back = await client.get(callbackPath(oidc.approve(authorizationUrl, anna)));
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toBe("/account?loggedIn");
    expect(back.headers.get("referrer-policy")).toBe("no-referrer");
    expect(client.cookies.has("__Host-rr-device")).toBe(true);
    expect(client.cookies.has("__Host-rr-login")).toBe(false);
    const account = text(await (await client.get("/account?loggedIn")).text());
    expect(account).toContain(en("account.loggedIn"));
    expect(account).toContain('value="Anna Example"');
    expect(account).toContain('action="/account/logout"');
    expect(identities(database)).toHaveLength(1);
    expect(database.sqlite.prepare("select count(*) from pending_logins").pluck().get()).toBe(0);
  });

  it("finds the same account from another browser", async () => {
    const { app, oidc, database } = await setup();
    await logIn(new TestClient(app), oidc);
    const other = new TestClient(app);
    await logIn(other, oidc, { sub: anna.sub, name: "Different name" });
    expect(identities(database)).toHaveLength(1);
    expect(text(await (await other.get("/account")).text())).toContain('value="Anna Example"');
  });

  it("keeps tokens, codes, state and the subject out of logs and plain storage", async () => {
    const { app, oidc, database, logs } = await setup();
    const client = new TestClient(app);
    const authorizationUrl = await startLogin(client);
    const callback = oidc.approve(authorizationUrl, anna);
    await client.get(callbackPath(callback));
    const tokenRequest = oidc.requests.find((request) => request.url.endsWith("/token"));
    const [issued] = oidc.issued;
    const secrets = [
      anna.sub,
      callback.searchParams.get("code") ?? "",
      authorizationUrl.searchParams.get("state") ?? "",
      authorizationUrl.searchParams.get("nonce") ?? "",
      new URLSearchParams(tokenRequest?.body).get("code_verifier") ?? "",
      issued?.accessToken ?? "",
      issued?.idToken ?? "",
    ];
    for (const secret of secrets) expect(secret).not.toBe("");
    const stored = JSON.stringify(identities(database));
    for (const secret of secrets) {
      expect(logs.join("\n")).not.toContain(secret);
      expect(stored).not.toContain(secret);
    }
    expect(stored).not.toContain("Anna Example");
    expect(logs.join("\n")).toContain("/login/oidc/callback");
  });

  it("treats login URLs as secret: never echoed into other URLs", async () => {
    expect(isSecretLinkPath("/login/oidc/callback")).toBe(true);
    expect(isSecretLinkPath("/login")).toBe(true);
    expect(isSecretLinkPath("/loginx")).toBe(false);
    const { app } = await setup();
    const failed = await new TestClient(app).get("/login/oidc/callback?code=SENTINEL-code&state=x");
    expect(await failed.text()).not.toContain("SENTINEL-code");
  });

  it("says when the provider cannot be reached, without counting against the rate limit", async () => {
    const { app, oidc } = await setup();
    oidc.down = true;
    const client = new TestClient(app);
    for (let i = 0; i < 12; i++) {
      const started = await client.get("/login/oidc");
      expect(started.status).toBe(502);
      expect(text(await started.text())).toContain(en("account.unavailable"));
    }
    oidc.down = false;
    expect((await client.get("/login/oidc")).status).toBe(303);
  });

  it("starts nothing when another site sends the browser to log in", async () => {
    const { app, database } = await setup();
    const client = new TestClient(app);
    const started = await client.request("/login/oidc", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(started.status).toBe(303);
    expect(started.headers.get("location")).toBe("/account");
    expect(client.cookies.has("__Host-rr-login")).toBe(false);
    expect(database.sqlite.prepare("select count(*) from pending_logins").pluck().get()).toBe(0);
    for (const site of ["same-origin", "none"]) {
      const own = await client.request("/login/oidc", { headers: { "sec-fetch-site": site } });
      expect(own.headers.get("location")).toMatch(/^https:\/\/id\.example\.org\//);
    }
  });

  it("rate limits starting logins", async () => {
    const { app } = await setup();
    const client = new TestClient(app);
    for (let i = 0; i < 10; i++) expect((await client.get("/login/oidc")).status).toBe(303);
    expect((await client.get("/login/oidc")).status).toBe(429);
  });
});

describe("account takeover protections (spec 3.11)", () => {
  it("refuse a callback opened in a browser that did not start the login (login CSRF)", async () => {
    const { app, oidc, database } = await setup();
    const attacker = new TestClient(app);
    const callback = oidc.approve(await startLogin(attacker), { sub: "attacker" });
    const victim = new TestClient(app);
    const opened = await victim.get(callbackPath(callback));
    expect(opened.status).toBe(400);
    expect(text(await opened.text())).toContain(en("account.loginFailed"));
    expect(victim.cookies.has("__Host-rr-device")).toBe(false);
    expect(identities(database)).toEqual([]);
  });

  it("refuse a callback used twice", async () => {
    const { app, oidc } = await setup();
    const client = new TestClient(app);
    const authorizationUrl = await startLogin(client);
    const callback = oidc.approve(authorizationUrl, anna);
    expect((await client.get(callbackPath(callback))).status).toBe(303);
    // Same browser, same login cookie value put back: the login was taken already.
    client.cookies.set("__Host-rr-login", authorizationUrl.searchParams.get("state") ?? "");
    expect((await client.get(callbackPath(callback))).status).toBe(400);
  });

  it("refuse another login's code, and a login the person declined", async () => {
    const { app, oidc, database } = await setup();
    const victim = new TestClient(app);
    const victimLogin = await startLogin(victim);
    const attackerCode = oidc.approve(await startLogin(new TestClient(app)), { sub: "attacker" });
    attackerCode.searchParams.set("state", victimLogin.searchParams.get("state") ?? "");
    expect((await victim.get(callbackPath(attackerCode))).status).toBe(400);
    const declined = new TestClient(app);
    expect((await declined.get(callbackPath(oidc.deny(await startLogin(declined))))).status).toBe(
      400,
    );
    expect(identities(database)).toEqual([]);
  });

  it("refuse a login finished after ten minutes", async () => {
    const { app, oidc, clock } = await setup();
    const client = new TestClient(app);
    const callback = oidc.approve(await startLogin(client), anna);
    clock.set(new Date(clock.now().getTime() + 10 * 60_000));
    expect((await client.get(callbackPath(callback))).status).toBe(400);
  });
});

describe("the account page (spec 7 Identity)", () => {
  it("changes the display name, keeping what was typed on errors", async () => {
    const { app, oidc } = await setup();
    const client = new TestClient(app);
    await logIn(client, oidc);
    const page = await (await client.get("/account")).text();
    const renamed = await client.postForm("/account/name", {
      ...hiddenFields(page),
      displayName: "Anna R.",
    });
    expect(renamed.status).toBe(303);
    expect(renamed.headers.get("location")).toBe("/account?renamed");
    expect(text(await (await client.get("/account")).text())).toContain('value="Anna R."');
    const invalid = await client.postForm("/account/name", {
      ...hiddenFields(page),
      displayName: `SENTINEL${"x".repeat(50)}`,
    });
    expect(invalid.status).toBe(422);
    const html = text(await invalid.text());
    expect(html).toContain(en("field.too_long"));
    expect(html).toContain("SENTINELxxx");
  });

  it("logs this browser out, which needs the CSRF token", async () => {
    const { app, oidc, database } = await setup();
    const client = new TestClient(app);
    await logIn(client, oidc);
    expect((await client.postForm("/account/logout", {})).status).toBe(403);
    const page = await (await client.get("/account")).text();
    const out = await client.postForm("/account/logout", hiddenFields(page));
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/account?loggedOut");
    expect(text(await (await client.get("/account?loggedOut")).text())).toContain(
      en("account.loginWith", { name: "Club login" }),
    );
    expect(identities(database)).toHaveLength(1);
  });

  it("fills the poster's name on the create form", async () => {
    const { app, oidc } = await setup();
    const client = new TestClient(app);
    await logIn(client, oidc);
    expect(await (await client.get("/new")).text()).toContain('value="Anna Example"');
  });

  it("puts the account's name before the name of a plan this browser hosted (D67)", async () => {
    const { app, oidc } = await setup();
    const client = new TestClient(app);
    await createPlanViaUi(client, { posterName: "Guest alias" });
    await logIn(client, oidc);
    const html = await (await client.get("/new")).text();
    expect(html).toContain('value="Anna Example"');
    expect(html).not.toContain("Guest alias");
  });
});

describe("My data of a logged-in browser (spec 3.7)", () => {
  it("says the browser is logged in, and counts only the browser's own permission to post", async () => {
    const token = "admin-token-for-tests-0123456789abcdef";
    const { app, oidc } = await setup({ POSTING_MODE: "invite", ADMIN_TOKEN: token });
    const client = new TestClient(app);
    await logIn(client, oidc);
    const myData = text(await (await client.get("/my-data")).text());
    expect(myData).toContain(en("myData.loggedIn"));
    expect(myData).not.toContain(en("myData.empty"));
    // The account's permission, from an invite confirmed while logged in, is not the browser's.
    const admin = new TestClient(app);
    await admin.postForm("/admin/login", {
      ...hiddenFields(await (await admin.get("/admin/login")).text()),
      token,
    });
    const home = await (await admin.get("/admin/")).text();
    const created = await admin.postForm("/admin/invites", {
      ...hiddenFields(home.slice(home.indexOf('id="invites"'))),
      expiresOn: "",
      maxUses: "",
    });
    const invitePath = /https:\/\/runs\.example\.org(\/i\/[A-Za-z0-9_-]{43})/.exec(
      await created.text(),
    )?.[1];
    await client.postForm("/i", hiddenFields(await (await client.get(invitePath ?? "")).text()));
    expect((await client.get("/new")).status).toBe(200);
    const after = text(await (await client.get("/my-data")).text());
    expect(after).not.toContain(en("myData.mayPost", { date: "1 June 2026" }));
    const confirm = text(await (await client.get("/my-data/delete")).text());
    expect(confirm).not.toContain(en("myData.deleteMayPost"));
  });
});

describe("deleting a logged-in browser's data (spec 3.7)", () => {
  it("says the account stays, and keeps it while logging the browser out", async () => {
    const { app, oidc, database } = await setup();
    const client = new TestClient(app);
    await logIn(client, oidc);
    const confirm = text(await (await client.get("/my-data/delete")).text());
    expect(confirm).toContain(en("myData.deleteKeepsAccount"));
    await client.postForm("/my-data/delete", hiddenFields(confirm));
    expect(identities(database)).toHaveLength(1);
    expect(database.sqlite.prepare("select count(*) from devices").pluck().get()).toBe(0);
    expect(text(await (await client.get("/account")).text())).toContain(
      en("account.loginWith", { name: "Club login" }),
    );
  });
});

describe("claiming on the account page (spec 7 Identity)", () => {
  it("offers to move this browser's plans into the account, and does so only on request", async () => {
    const { app, oidc } = await setup();
    const phone = new TestClient(app);
    const { planId } = await createPlanViaUi(phone);
    await logIn(phone, oidc);
    const page = text(await (await phone.get("/account")).text());
    expect(page).toContain(en("account.claimPlans", { count: 1 }));
    expect(page).toContain('action="/account/claim"');

    const laptop = new TestClient(app);
    await logIn(laptop, oidc);
    // Not the laptop's yet: the host page sends it to the plan page.
    expect((await laptop.get(`/p/${planId}/host`)).status).toBe(303);
    expect((await phone.postForm("/account/claim", {})).status).toBe(403);
    const claimed = await phone.postForm("/account/claim", hiddenFields(page));
    expect(claimed.status).toBe(303);
    expect(claimed.headers.get("location")).toBe("/account?claimed");
    const after = text(await (await phone.get("/account?claimed")).text());
    expect(after).toContain(en("account.claimed"));
    expect(after).not.toContain('action="/account/claim"');
    expect((await laptop.get(`/p/${planId}/host`)).status).toBe(200);
  });

  it("puts plans created while logged in into the account right away", async () => {
    const { app, oidc } = await setup();
    const phone = new TestClient(app);
    await logIn(phone, oidc);
    const { planId } = await createPlanViaUi(phone);
    expect(text(await (await phone.get("/account")).text())).not.toContain(
      'action="/account/claim"',
    );
    const laptop = new TestClient(app);
    await logIn(laptop, oidc);
    expect((await laptop.get(`/p/${planId}/host`)).status).toBe(200);
  });
});

describe("the account's data on the account page (spec 3.7, 3.10)", () => {
  it("lists what the account owns, when it expires, and exports it", async () => {
    const { app, oidc } = await setup();
    const client = new TestClient(app);
    await logIn(client, oidc);
    const { planId } = await createPlanViaUi(client, { title: "Account run" });
    const page = text(await (await client.get("/account")).text());
    expect(page).toContain(en("account.dataHeading"));
    expect(page).toContain(`href="/p/${planId}"`);
    expect(page).toContain(en("account.deleteAt", { date: "1 June 2027" }));
    expect(page).toContain('href="/account/export.zip"');
    const exported = await client.get("/account/export.zip");
    expect(exported.headers.get("content-type")).toBe("application/zip");
    expect(exported.headers.get("cache-control")).toBe("private, no-store");
    const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    const data = JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array()));
    expect(data).toMatchObject({
      version: 7,
      account: { provider: "oidc", displayName: "Anna Example", handle: null },
      plans: [{ role: "host", plan: { title: "Account run" } }],
    });
    expect((await new TestClient(app).get("/account/export.zip")).status).toBe(404);
  });

  it("deletes the account after a confirmation listing what goes", async () => {
    const { app, oidc, database } = await setup();
    const client = new TestClient(app);
    await logIn(client, oidc);
    const { planId } = await createPlanViaUi(client, { title: "Account run" });
    const confirm = await (await client.get("/account/delete")).text();
    expect(text(confirm)).toContain(en("myData.deletePlans", { count: 1 }));
    expect(text(confirm)).toContain("Account run");
    expect((await client.postForm("/account/delete", {})).status).toBe(403);
    const deleted = await client.postForm("/account/delete", hiddenFields(confirm));
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe("/account?accountDeleted");
    const after = text(await (await client.get("/account?accountDeleted")).text());
    expect(after).toContain(en("account.accountDeleted"));
    expect(after).toContain(en("account.loginWith", { name: "Club login" }));
    expect(identities(database)).toEqual([]);
    expect((await client.get(`/p/${planId}`)).status).toBe(404);
    expect((await new TestClient(app).get("/account/delete")).status).toBe(303);
  });
});

describe("POSTING_MODE=logged_in (spec 7 Moderation)", () => {
  it("lets only logged-in browsers create plans, and says how to log in", async () => {
    const { app, oidc, database } = await setup({ POSTING_MODE: "logged_in" });
    const visitor = new TestClient(app);
    const form = await visitor.get("/new");
    expect(form.status).toBe(200);
    const html = text(await form.text());
    expect(html).toContain(en("posting.loginNeeded"));
    expect(html).toContain('href="/account"');
    expect(html).not.toContain('name="title"');
    const _csrf = hiddenFields(await (await visitor.get("/")).text())._csrf ?? "";
    const forged = await visitor.postForm("/new", { _csrf, nonce: "n".repeat(22), ...planForm() });
    expect(forged.status).toBe(403);
    expect(database.sqlite.prepare("select count(*) from plans").pluck().get()).toBe(0);

    await logIn(visitor, oidc);
    await createPlanViaUi(visitor);
    expect(database.sqlite.prepare("select count(*) from plans").pluck().get()).toBe(1);
  });
});

describe("invite links and accounts (spec 7 Moderation)", () => {
  it("let the account post from every browser it logs in on", async () => {
    const token = "admin-token-for-tests-0123456789abcdef";
    const { app, oidc } = await setup({ POSTING_MODE: "invite", ADMIN_TOKEN: token });
    const admin = new TestClient(app);
    await admin.postForm("/admin/login", {
      ...hiddenFields(await (await admin.get("/admin/login")).text()),
      token,
    });
    const home = await (await admin.get("/admin/")).text();
    const created = await admin.postForm("/admin/invites", {
      ...hiddenFields(home.slice(home.indexOf('id="invites"'))),
      expiresOn: "",
      maxUses: "1",
    });
    const invitePath = /https:\/\/runs\.example\.org(\/i\/[A-Za-z0-9_-]{43})/.exec(
      await created.text(),
    )?.[1];
    const phone = new TestClient(app);
    await logIn(phone, oidc);
    await phone.postForm("/i", hiddenFields(await (await phone.get(invitePath ?? "")).text()));
    expect((await phone.get("/new")).status).toBe(200);
    expect(await (await phone.get("/new")).text()).toContain('name="title"');

    const laptop = new TestClient(app);
    expect(text(await (await laptop.get("/new")).text())).toContain(en("posting.inviteNeeded"));
    await logIn(laptop, oidc);
    await createPlanViaUi(laptop);
  });
});

describe("the privacy notice (spec 5 feature 13)", () => {
  it("names the login provider, what is kept and the login cookie", async () => {
    const { app } = await setup();
    const html = text(await (await new TestClient(app).get("/privacy")).text());
    expect(html).toContain(en("privacy.oidc", { name: "Club login", host: "id.example.org" }));
    expect(html).toContain(en("privacy.cookieLogin", { minutes: 10 }));
    expect(html).toContain(en("privacy.accountExpiry", { days: 365 }));
    const { app: plain } = await createTestApp();
    const without = text(await (await new TestClient(plain).get("/privacy")).text());
    expect(without).not.toContain(en("privacy.cookieLogin", { minutes: 10 }));
  });
});
