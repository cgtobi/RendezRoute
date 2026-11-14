// The admin pages on their own listener (decision D55; plan 0.10 step 10a): the public app answers
// 404 on /admin, the admin-only app serves the admin pages with its own cookies and CSRF rules.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi } from "../../support/plans.ts";

const en = translator("en");
const TOKEN = "admin-token-for-tests-0123456789abcdef";
const SPLIT = { ADMIN_TOKEN: TOKEN, ADMIN_PORT: "3001" };
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');

async function setup(env: Record<string, string> = SPLIT) {
  const test = await createTestApp({ env });
  if (test.adminApp === undefined) throw new Error("no admin app");
  return {
    ...test,
    adminApp: test.adminApp,
    admin: new TestClient(test.adminApp),
    visitor: new TestClient(test.app),
  };
}

async function logIn(admin: TestClient, token = TOKEN) {
  const fields = hiddenFields(await (await admin.get("/admin/login")).text());
  return admin.postForm("/admin/login", { ...fields, token });
}

/** The token for a post from the page the admin sees once logged in. */
const adminFields = async (admin: TestClient) =>
  hiddenFields(await (await admin.get("/admin/")).text());

const PUBLIC_ADMIN_PATHS = [
  "/admin",
  "/admin/",
  "/admin/login",
  "/admin/logout",
  "/admin/reports",
  "/admin/plans",
  "/admin/invites",
];

describe("the public app with ADMIN_PORT set", () => {
  it("answers 404 on /admin and everything below it, like any unknown path", async () => {
    const { visitor } = await setup({ ...SPLIT, POSTING_MODE: "invite" });
    const unknown = await visitor.get("/no-such-page");
    expect(unknown.status).toBe(404);
    for (const path of PUBLIC_ADMIN_PATHS) {
      expect((await visitor.get(path)).status, `GET ${path}`).toBe(404);
      // With a valid CSRF token, so the 404 is the route's, not the token check's.
      const fields = await visitor.hiddenFields("/privacy");
      expect((await visitor.postForm(path, fields)).status, `POST ${path}`).toBe(404);
    }
  });

  it("still has the report form and the plan page's report link", async () => {
    const { app, database } = await setup();
    const { planId } = await createPlanViaUi(new TestClient(app));
    expect(await (await new TestClient(app).get(`/p/${planId}`)).text()).toContain(
      `href="/p/${planId}/report"`,
    );
    const reporter = new TestClient(app);
    const form = await reporter.hiddenFields(`/p/${planId}/report`);
    const sent = await reporter.postForm(`/p/${planId}/report`, { ...form, reason: "spam" });
    expect(sent.status).toBe(303);
    expect(database.sqlite.prepare("select count(*) from reports").pluck().get()).toBe(1);
  });

  it("has the invite pages (an invite from the admin app is used here, see below)", async () => {
    const { visitor } = await setup({ ...SPLIT, POSTING_MODE: "invite" });
    // The new-plan page explains the posting rules instead of the form; it is not a 404.
    expect((await visitor.get("/new")).status).toBe(200);
  });

  it("does not link the admin pages", async () => {
    // The footer is where a link would show up; the privacy link proves it is rendered.
    const { visitor } = await setup();
    for (const path of ["/", "/privacy", "/my-data"]) {
      const html = await (await visitor.get(path)).text();
      expect(html).toContain('href="/privacy"');
      expect(html).not.toMatch(/href="[^"]*admin/);
    }
  });
});

describe("the admin-only app", () => {
  it("serves login, session, plan overview and deletion, report resolution and invites", async () => {
    const { admin, app, database } = await setup({ ...SPLIT, POSTING_MODE: "invite" });
    expect((await admin.get("/admin")).headers.get("location")).toBe("admin/");
    expect((await admin.get("/admin/")).headers.get("location")).toBe("../admin/login");
    const login = await admin.get("/admin/login");
    expect(login.status).toBe(200);
    expect(login.headers.get("cache-control")).toBe("no-store");
    expect((await logIn(admin, "not-the-token")).status).toBe(401);
    const loggedIn = await logIn(admin);
    expect(loggedIn.status).toBe(303);
    expect(loggedIn.headers.get("location")).toBe("../admin/");

    // An invite from the admin page works on the public app.
    const home = await (await admin.get("/admin/")).text();
    const inviteFields = hiddenFields(home.slice(home.indexOf('id="invites"')));
    const created = await admin.postForm("/admin/invites", {
      ...inviteFields,
      expiresOn: "",
      maxUses: "",
    });
    expect(created.status).toBe(200);
    const link = /https:\/\/runs\.example\.org(\/i\/[A-Za-z0-9_-]{43})/.exec(await created.text());
    expect(link?.[1]).toBeDefined();
    const person = new TestClient(app);
    const invitePage = await person.get(link?.[1] ?? "");
    const used = await person.postForm("/i", hiddenFields(await invitePage.text()));
    expect(used.status).toBeLessThan(400);
    const { planId } = await createPlanViaUi(person);

    // Reports: filed on the public app, resolved on the admin app.
    const reporter = new TestClient(app);
    const form = await reporter.hiddenFields(`/p/${planId}/report`);
    await reporter.postForm(`/p/${planId}/report`, { ...form, reason: "unsafe", details: "SENT" });
    expect(text(await (await admin.get("/admin/")).text())).toContain(
      en("admin.openReports", { count: 1 }),
    );
    const plan = await (await admin.get(`/admin/plans/${planId}`)).text();
    const resolvePath = /action="\.\.\/\.\.(\/admin\/reports\/[^"]+\/resolve)"/.exec(plan)?.[1];
    expect((await admin.postForm(resolvePath ?? "", hiddenFields(plan))).status).toBe(303);
    expect(
      database.sqlite
        .prepare("select count(*) from reports where resolved_at is null")
        .pluck()
        .get(),
    ).toBe(0);

    // Revoke the invite, find the plan, delete it.
    const after = await (await admin.get("/admin/")).text();
    const revoke = /action="\.\.(\/admin\/invites\/[^"]+\/revoke)"/.exec(after)?.[1];
    expect((await admin.postForm(revoke ?? "", await adminFields(admin))).status).toBe(303);
    const lookup = await admin.postForm("/admin/plans", {
      ...(await adminFields(admin)),
      plan: planId,
    });
    expect(lookup.headers.get("location")).toBe(`../admin/plans/${planId}`);
    const planPage = await (await admin.get(`/admin/plans/${planId}`)).text();
    const deleted = await admin.postForm(`/admin/plans/${planId}/delete`, hiddenFields(planPage));
    expect(deleted.headers.get("location")).toBe("../../../admin/?deleted");
    expect((await new TestClient(app).get(`/p/${planId}`)).status).toBe(404);

    const out = await admin.postForm("/admin/logout", await adminFields(admin));
    expect(out.headers.get("location")).toBe("../admin/login");
    expect((await admin.get("/admin/")).status).toBe(303);
  });

  it("redirects its root to the admin home with a relative address", async () => {
    const { admin } = await setup();
    const root = await admin.get("/");
    expect(root.status).toBe(303);
    expect(root.headers.get("location")).toBe("admin/");
  });

  it("leaves the public footer links out of its pages and links the logo to the admin home", async () => {
    const { admin } = await setup({ ...SPLIT, NEARBY_ENABLED: "true" });
    const pages = [await admin.get("/admin/login"), await admin.get("/no-such-page")];
    await logIn(admin);
    pages.push(await admin.get("/admin/"));
    for (const page of pages) {
      const html = await page.text();
      for (const path of ["/privacy", "/my-data", "/nearby", "/account"]) {
        expect(html).not.toMatch(new RegExp(`href="[^"]*${path}"`));
      }
      expect(html).not.toContain("footer-menu");
    }
    expect(await (await admin.get("/admin/")).text()).toContain('<a href="../admin/">');
  });

  it("renders no empty legal-links element without PRIVACY_URL or IMPRINT_URL", async () => {
    const { admin } = await setup();
    expect(await (await admin.get("/admin/login")).text()).not.toContain("legal-links");
    const withLinks = await setup({ ...SPLIT, PRIVACY_URL: "https://example.org/privacy" });
    const html = await (await withLinks.admin.get("/admin/login")).text();
    expect(html).toContain('<p class="legal-links"><a href="https://example.org/privacy"');
  });

  it("keeps today's layout for the admin pages of an unsplit instance", async () => {
    const test = await createTestApp({ env: { ADMIN_TOKEN: TOKEN } });
    const html = await (await new TestClient(test.app).get("/admin/login")).text();
    expect(html).toContain('href="../privacy"');
    expect(html).toContain('href="../my-data"');
    expect(html).toContain('<a href="../">');
  });

  it("serves its pages' assets and /healthz, and limits login attempts", async () => {
    const { admin } = await setup();
    expect((await admin.get("/healthz")).status).toBe(200);
    const css = await admin.get("/static/app.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-security-policy")).toContain("default-src 'self'");
    for (let attempt = 0; attempt < 5; attempt++) await logIn(admin, "not-the-token");
    expect((await logIn(admin)).status).toBe(429);
  });

  it("answers 404 for every public route, with the security headers", async () => {
    const { admin } = await setup();
    for (const path of [
      "/p/abcdefghijklmnopqrstuv",
      "/inbox",
      "/.well-known/webfinger?resource=acct:x@runs.example.org",
      "/nearby",
      "/new",
      "/privacy",
      "/my-data",
      "/sw.js",
      "/federation/notes/abc/route.gpx",
    ]) {
      const response = await admin.get(path);
      expect([path, response.status]).toEqual([path, 404]);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
    // A post to the inbox is not federation: without a token the CSRF check refuses it, with the
    // admin app's own token it reaches the router, which has no such route.
    expect((await admin.request("/inbox", { method: "POST", body: "{}" })).status).toBe(403);
    const fields = hiddenFields(await (await admin.get("/admin/login")).text());
    expect((await admin.postForm("/inbox", fields)).status).toBe(404);
  });

  it("is not built without ADMIN_PORT", async () => {
    const test = await createTestApp({ env: { ADMIN_TOKEN: TOKEN } });
    expect(test.adminApp).toBeUndefined();
  });
});

const setCookies = (response: Response) => response.headers.getSetCookie();

describe("cookies of the admin listener (decision D55)", () => {
  it("uses its own names, HttpOnly and SameSite=Strict, and no Secure over plain http", async () => {
    const { admin } = await setup();
    const login = await admin.get("/admin/login");
    const [csrf = ""] = setCookies(login);
    expect(csrf).toMatch(/^rr-admin-csrf=[A-Za-z0-9_-]{43}; /);
    expect(csrf).toMatch(/HttpOnly/);
    expect(csrf).toMatch(/SameSite=Strict/);
    expect(csrf).toMatch(/Path=\//);
    expect(csrf).not.toMatch(/Secure/);
    const posted = await logIn(admin);
    const [session = ""] = setCookies(posted);
    expect(session).toMatch(/^rr-admin-split=\d{13}\./);
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Strict/);
    expect(session).toMatch(/Path=\//);
    expect(session).toMatch(/Max-Age=43200/);
    expect(session).not.toMatch(/Secure/);
    expect(setCookies(login).join()).not.toContain("__Host");
  });

  it("is Secure when the request arrived over https", async () => {
    const { admin } = await setup();
    const login = await admin.request("https://admin.example/admin/login");
    expect(setCookies(login)[0]).toMatch(/^rr-admin-csrf=.*; Secure/);
    const fields = hiddenFields(await login.text());
    const posted = await admin.request("https://admin.example/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, token: TOKEN }).toString(),
    });
    expect(posted.status).toBe(303);
    expect(setCookies(posted)[0]).toMatch(/^rr-admin-split=.*; Secure/);
  });

  it("takes the proxy's protocol only with TRUST_PROXY, and then its own (rightmost) entry", async () => {
    const forwarded = (proto: string) => ({ "x-forwarded-proto": proto });
    const secure = async (env: Record<string, string>, headers: Record<string, string>) => {
      const { adminApp } = await setup({ ...SPLIT, ...env });
      return /; Secure/.test(
        setCookies(await adminApp.request("/admin/login", { headers })).join(),
      );
    };
    expect(await secure({}, forwarded("https"))).toBe(false);
    expect(await secure({ TRUST_PROXY: "true" }, forwarded("https"))).toBe(true);
    expect(await secure({ TRUST_PROXY: "true" }, forwarded("http"))).toBe(false);
    expect(await secure({ TRUST_PROXY: "true" }, forwarded("http, https"))).toBe(true);
    expect(await secure({ TRUST_PROXY: "true" }, forwarded("https, http"))).toBe(false);
    expect(await secure({ TRUST_PROXY: "true" }, {})).toBe(false);
  });

  it("is Secure whenever ADMIN_URL is https, even over plain http and without TRUST_PROXY", async () => {
    const { admin } = await setup({ ...SPLIT, ADMIN_URL: "https://admin.example.org" });
    const login = await admin.get("/admin/login");
    expect(setCookies(login)[0]).toMatch(/^rr-admin-csrf=.*; Secure/);
    const posted = await admin.request("/admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://admin.example.org",
      },
      body: new URLSearchParams({ ...hiddenFields(await login.text()), token: TOKEN }).toString(),
    });
    expect(posted.status).toBe(303);
    expect(setCookies(posted)[0]).toMatch(/^rr-admin-split=.*; Secure/);
    // The proxy header cannot turn it off.
    const proxied = await setup({
      ...SPLIT,
      ADMIN_URL: "https://admin.example.org",
      TRUST_PROXY: "true",
    });
    const http = await proxied.adminApp.request("/admin/login", {
      headers: { "x-forwarded-proto": "http" },
    });
    expect(setCookies(http)[0]).toMatch(/; Secure/);
  });

  it("follows the request when ADMIN_URL is http or unset", async () => {
    for (const env of [{}, { ADMIN_URL: "http://localhost:3105" }]) {
      const plain = await setup({ ...SPLIT, ...env });
      expect(setCookies(await plain.adminApp.request("/admin/login")).join()).not.toMatch(
        /; Secure/,
      );
      const proxied = await setup({ ...SPLIT, ...env, TRUST_PROXY: "true" });
      const response = await proxied.adminApp.request("/admin/login", {
        headers: { "x-forwarded-proto": "http, https" },
      });
      expect(setCookies(response)[0]).toMatch(/; Secure/);
    }
  });

  it("keeps the admin session apart from the public admin's, both ways", async () => {
    const split = await setup();
    await logIn(split.admin);
    const sessionValue = split.admin.cookies.get("rr-admin-split") ?? "";
    expect(sessionValue).not.toBe("");

    // The public admin of an instance with the same token (not split): its cookie is no session here.
    const plain = await createTestApp({ env: { ADMIN_TOKEN: TOKEN } });
    const publicAdmin = new TestClient(plain.app);
    await logIn(publicAdmin);
    const publicValue = publicAdmin.cookies.get("__Host-rr-admin") ?? "";
    expect(publicValue).not.toBe("");
    const replayed = new TestClient(split.adminApp);
    replayed.cookies.set("rr-admin-split", publicValue);
    expect((await replayed.get("/admin/")).status).toBe(303);

    // And the split session value is no session on the public admin, under its own name.
    const reverse = new TestClient(plain.app);
    reverse.cookies.set("__Host-rr-admin", sessionValue);
    expect((await reverse.get("/admin/")).status).toBe(303);
    // Control: the genuine value works where it was issued.
    const genuine = new TestClient(split.adminApp);
    genuine.cookies.set("rr-admin-split", sessionValue);
    expect((await genuine.get("/admin/")).status).toBe(200);
  });

  it("ignores the public admin cookie names", async () => {
    const split = await setup();
    await logIn(split.admin);
    const value = split.admin.cookies.get("rr-admin-split") ?? "";
    const other = new TestClient(split.adminApp);
    other.cookies.set("rr-admin", value);
    other.cookies.set("__Host-rr-admin", value);
    expect((await other.get("/admin/")).status).toBe(303);
  });
});

describe("CSRF on the admin listener (decision D55)", () => {
  /** Posts the login form with the page's own token and these extra headers. */
  async function login(env: Record<string, string>, headers: Record<string, string>) {
    const { admin } = await setup({ ...SPLIT, ...env });
    const fields = hiddenFields(await (await admin.get("/admin/login")).text());
    const response = await admin.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({ ...fields, token: TOKEN }).toString(),
    });
    return response.status;
  }
  const ADMIN_URL = { ADMIN_URL: "http://localhost:3105" };

  it("with ADMIN_URL, takes only that origin", async () => {
    expect(await login(ADMIN_URL, { origin: "http://localhost:3105" })).toBe(303);
    expect(await login(ADMIN_URL, { origin: "http://localhost:3105", host: "other:1" })).toBe(303);
    expect(await login(ADMIN_URL, { origin: "https://evil.example" })).toBe(403);
    // The Host header does not matter once ADMIN_URL says where the admin is.
    expect(
      await login(ADMIN_URL, { origin: "http://127.0.0.1:3001", host: "127.0.0.1:3001" }),
    ).toBe(403);
    // The public instance's origin is not the admin's.
    expect(await login(ADMIN_URL, { origin: "https://runs.example.org" })).toBe(403);
  });

  it("without ADMIN_URL, takes the origin whose host is the Host header's", async () => {
    const host = "127.0.0.1:3001";
    expect(await login({}, { origin: `http://${host}`, host })).toBe(303);
    expect(await login({}, { origin: `https://${host}`, host })).toBe(303);
    expect(await login({}, { origin: "http://192.168.1.5:3001", host: "192.168.1.5:3001" })).toBe(
      303,
    );
    expect(await login({}, { origin: "http://evil.example", host })).toBe(403);
    expect(await login({}, { origin: `http://${host}`, host: "127.0.0.1:3002" })).toBe(403);
    // Origin without a Host header proves nothing.
    expect(await login({}, { origin: `http://${host}` })).toBe(403);
    expect(await login({}, { origin: "https://runs.example.org" })).toBe(403);
  });

  it("without ADMIN_URL, refuses a cross-site request even with matching hosts", async () => {
    const host = "127.0.0.1:3001";
    const origin = `http://${host}`;
    expect(await login({}, { origin, host, "sec-fetch-site": "cross-site" })).toBe(403);
    expect(await login({}, { origin, host, "sec-fetch-site": "same-origin" })).toBe(303);
    // Another port on the same host is same-site, not cross-site.
    expect(await login({}, { origin, host, "sec-fetch-site": "same-site" })).toBe(303);
  });

  it("takes Origin: null only with Sec-Fetch-Site: same-origin", async () => {
    for (const env of [{}, ADMIN_URL]) {
      expect(await login(env, { origin: "null", "sec-fetch-site": "same-origin" })).toBe(303);
      expect(await login(env, { origin: "null" })).toBe(403);
      expect(await login(env, { origin: "null", "sec-fetch-site": "same-site" })).toBe(403);
      expect(await login(env, { origin: "null", "sec-fetch-site": "cross-site" })).toBe(403);
      expect(await login(env, { origin: "null", "sec-fetch-site": "none" })).toBe(403);
    }
  });

  it("without an Origin falls back to Sec-Fetch-Site, as on the public app", async () => {
    for (const env of [{}, ADMIN_URL]) {
      expect(await login(env, {})).toBe(303);
      expect(await login(env, { "sec-fetch-site": "same-origin" })).toBe(303);
      expect(await login(env, { "sec-fetch-site": "none" })).toBe(303);
      expect(await login(env, { "sec-fetch-site": "cross-site" })).toBe(403);
      expect(await login(env, { "sec-fetch-site": "same-site" })).toBe(403);
    }
  });

  it("refuses posts without a token or with a public page's token", async () => {
    const { admin, adminApp, visitor } = await setup();
    expect((await admin.postForm("/admin/login", { token: TOKEN })).status).toBe(403);

    // The token and cookie of a public form, replayed on the admin app under its cookie name.
    const publicFields = await visitor.hiddenFields("/privacy");
    const publicCookie = visitor.cookies.get("__Host-rr-csrf") ?? visitor.cookies.get("rr-csrf");
    expect(publicCookie).toBeDefined();
    const replayer = new TestClient(adminApp);
    replayer.cookies.set("rr-admin-csrf", publicCookie ?? "");
    const replayed = await replayer.postForm("/admin/login", { ...publicFields, token: TOKEN });
    expect(replayed.status).toBe(403);
    // Under the public name the admin app does not even look at it.
    replayer.cookies.clear();
    replayer.cookies.set("__Host-rr-csrf", publicCookie ?? "");
    replayer.cookies.set("rr-csrf", publicCookie ?? "");
    expect(
      (await replayer.postForm("/admin/login", { ...publicFields, token: TOKEN })).status,
    ).toBe(403);
  });
});

describe("the report alert email (decision D55)", () => {
  const SMTP = { SMTP_HOST: "mail.example.org", SMTP_FROM: "runs@example.org" };

  /** Reports a plan on the public app and returns the alert the contact address got. */
  async function alert(env: Record<string, string>) {
    const { app, runJobs, mailer } = await createTestApp({
      env: { ADMIN_TOKEN: TOKEN, ...SMTP, ...env },
    });
    const { planId } = await createPlanViaUi(new TestClient(app));
    const reporter = new TestClient(app);
    const form = await reporter.hiddenFields(`/p/${planId}/report`);
    expect(
      (await reporter.postForm(`/p/${planId}/report`, { ...form, reason: "spam" })).status,
    ).toBe(303);
    await runJobs();
    const mail = mailer.sent.find((sent) => sent.to === "owner@example.org");
    if (mail === undefined) throw new Error("no alert sent");
    return mail;
  }

  it("links to the admin pages on the public origin when not split", async () => {
    const mail = await alert({});
    expect(mail.text).toContain("https://runs.example.org/admin/");
  });

  it("links to ADMIN_URL when the admin listener has one", async () => {
    const mail = await alert({ ADMIN_PORT: "3001", ADMIN_URL: "https://admin.example.org" });
    expect(mail.text).toContain("https://admin.example.org/admin/");
    expect(mail.text).not.toContain("https://runs.example.org");
  });

  it("carries no link when the admin listener has no ADMIN_URL", async () => {
    const mail = await alert({ ADMIN_PORT: "3001" });
    expect(mail.text).not.toMatch(/https?:\/\//);
    expect(mail.text).toContain(en("email.reportBodyNoLink"));
  });
});
