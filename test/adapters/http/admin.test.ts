// The instance admin through the web pages (spec 7 Moderation, 3.8 URLs; plan v1.0 step 1).
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const TOKEN = "admin-token-for-tests-0123456789abcdef";
const text = (html: string) => html.replaceAll("&#39;", "'");

async function setup(env: Record<string, string> = { ADMIN_TOKEN: TOKEN }) {
  const test = await createTestApp({ env });
  return { ...test, admin: new TestClient(test.app) };
}

async function logIn(admin: TestClient, token = TOKEN) {
  const fields = hiddenFields(await (await admin.get("/admin/login")).text());
  return admin.postForm("/admin/login", { ...fields, token });
}

/** Where Home Assistant Ingress (or any proxy) serves the app (spec 3.8 URLs). */
const PREFIX = "https://ha.example/api/hassio_ingress/abc";
const ADMIN_POSTS =
  /^\/admin\/(?:login|logout|plans|plans\/[A-Za-z0-9_-]{22}\/delete|reports\/[A-Za-z0-9-]+\/resolve|invites|invites\/[A-Za-z0-9-]+\/revoke)$/;

/**
 * Follows every link, asset, form action and redirect of an admin response as a browser would when
 * the page is served under PREFIX: each must stay under the prefix and reach a real route.
 */
async function expectWorksUnderPrefix(client: TestClient, path: string, response: Response) {
  const html = await response.text();
  const page = `${PREFIX}${path}`;
  const found = [...html.matchAll(/\b(href|src|action|formaction)=(["'])(.*?)\2/g)].map(
    ([, attribute = "", , url = ""]) => ({ attribute, url: url.replaceAll("&amp;", "&") }),
  );
  const location = response.headers.get("location");
  if (location !== null) found.push({ attribute: "location", url: location });
  expect(found.length).toBeGreaterThan(0);
  for (const { attribute, url } of found) {
    if (url.startsWith("data:")) continue;
    const resolved = new URL(url, page).href;
    expect(resolved, `${attribute}="${url}" on ${path}`).toMatch(new RegExp(`^${PREFIX}/`));
    const target = new URL(resolved.slice(PREFIX.length), "http://app").pathname;
    // Forms must post to an admin route; links, assets and redirects must load.
    const reachesRoute =
      attribute === "action" || attribute === "formaction"
        ? ADMIN_POSTS.test(target)
        : (await client.get(target)).status !== 404;
    expect(reachesRoute, `${attribute}="${url}" on ${path} reaches ${target}`).toBe(true);
  }
}

describe("instance admin login (spec 7 Moderation)", () => {
  it("does not exist without ADMIN_TOKEN", async () => {
    const { admin } = await setup({});
    for (const path of ["/admin", "/admin/", "/admin/login"]) {
      expect((await admin.get(path)).status).toBe(404);
    }
  });

  it("sends every admin page to the login, with relative redirects", async () => {
    const { admin } = await setup();
    expect((await admin.get("/admin")).headers.get("location")).toBe("admin/");
    expect((await admin.get("/admin/")).headers.get("location")).toBe("../admin/login");
    expect((await admin.get("/admin/plans/abc")).headers.get("location")).toBe("../../admin/login");
    const login = await admin.get("/admin/login");
    expect(login.status).toBe(200);
    expect(login.headers.get("cache-control")).toBe("no-store");
    expect(login.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("refuses a wrong token, and limits attempts", async () => {
    const { admin } = await setup();
    const wrong = await logIn(admin, "not-the-token");
    expect(wrong.status).toBe(401);
    expect(text(await wrong.text())).toContain(en("admin.loginFailed"));
    for (let attempt = 0; attempt < 4; attempt++) await logIn(admin, "not-the-token");
    expect((await logIn(admin)).status).toBe(429);
  });

  it("starts a separate, strict, 12-hour session on the right token", async () => {
    const { admin } = await setup();
    const loggedIn = await logIn(admin);
    expect(loggedIn.status).toBe(303);
    expect(loggedIn.headers.get("location")).toBe("../admin/");
    const cookie = loggedIn.headers.getSetCookie().find((c) => c.startsWith("__Host-rr-admin="));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Max-Age=43200/);
    expect(cookie).toMatch(/Path=\//);
    expect((await admin.get("/admin/")).status).toBe(200);
  });

  it("ends the session after 12 hours, on logout, or when the token changes", async () => {
    const { admin, clock } = await setup();
    await logIn(admin);
    clock.advance({ hours: 12 });
    expect((await admin.get("/admin/")).status).toBe(303);

    clock.advance({ hours: -12 });
    await logIn(admin);
    const fields = hiddenFields(await (await admin.get("/admin/")).text());
    await admin.postForm("/admin/logout", fields);
    expect((await admin.get("/admin/")).status).toBe(303);

    // The same cookie on an instance with another token is no session.
    await logIn(admin);
    const other = await createTestApp({ env: { ADMIN_TOKEN: `${TOKEN}-changed` } });
    const moved = new TestClient(other.app);
    for (const [name, value] of admin.cookies) moved.cookies.set(name, value);
    expect((await moved.get("/admin/")).status).toBe(303);
  });

  it("never treats a device as the admin, nor the admin as a device", async () => {
    const { admin, app } = await setup();
    const host = new TestClient(app);
    await createPlanViaUi(host);
    expect((await host.get("/admin/")).status).toBe(303);
    await logIn(admin);
    expect(await (await admin.get("/my-data")).text()).toContain(en("myData.empty"));
    const forged = new TestClient(app);
    forged.cookies.set("__Host-rr-admin", `${Date.now() + 1000}.${"A".repeat(43)}`);
    expect((await forged.get("/admin/")).status).toBe(303);
  });
});

describe("the instance admin's pages (spec 7 Moderation, 3.6 Instance admin column)", () => {
  it("work under any path prefix: every link, form and redirect stays under it (spec 3.8)", async () => {
    const { admin, app, database } = await setup();
    const { planId } = await createPlanViaUi(new TestClient(app));
    const other = await createPlanViaUi(new TestClient(app));
    const reporter = new TestClient(app);
    const reportForm = hiddenFields(await (await reporter.get(`/p/${planId}/report`)).text());
    await reporter.postForm(`/p/${planId}/report`, { ...reportForm, reason: "spam" });
    const reportId = String(database.sqlite.prepare("select id from reports").pluck().get());
    const pages: [string, Response][] = [];
    const get = async (path: string) => pages.push([path, await admin.get(path)]);
    const post = async (path: string, fields: Record<string, string>) => {
      const _csrf = hiddenFields(await (await admin.get("/privacy")).text())._csrf ?? "";
      pages.push([path, await admin.postForm(path, { _csrf, ...fields })]);
    };

    await get("/admin");
    await get("/admin/");
    await get(`/admin/plans/${planId}`);
    await get("/admin/login");
    await post("/admin/login", { token: "not-the-token" });
    await post("/admin/login", { token: TOKEN });
    await get("/admin/");
    await get("/admin/login");
    await get("/admin/?deleted");
    await post("/admin/plans", { plan: planId });
    await post("/admin/plans", { plan: "no plan here" });
    await get(`/admin/plans/${planId}`);
    await post(`/admin/reports/${reportId}/resolve`, {});
    await post(`/admin/reports/${reportId}/resolve`, {});
    await get("/admin/plans/unknown");
    await post(`/admin/plans/${other.planId}/delete`, {});
    await post(`/admin/plans/${other.planId}/delete`, {});
    await post("/admin/logout", {});
    expect(pages.map(([, response]) => response.status)).toEqual([
      303, 303, 303, 200, 401, 303, 200, 303, 200, 303, 422, 200, 303, 303, 404, 303, 404, 303,
    ]);
    await logIn(admin);
    for (const [path, response] of pages) await expectWorksUnderPrefix(admin, path, response);
  });

  it("work under any path prefix with invite links too (spec 3.8, 7 Moderation)", async () => {
    const { admin } = await setup({ ADMIN_TOKEN: TOKEN, POSTING_MODE: "invite" });
    await logIn(admin);
    const pages: [string, Response][] = [];
    const post = async (path: string, fields: Record<string, string>) => {
      const home = await (await admin.get("/admin/")).text();
      const form = hiddenFields(home.slice(home.indexOf('id="invites"')));
      pages.push([path, await admin.postForm(path, { ...form, ...fields })]);
    };
    pages.push(["/admin/", await admin.get("/admin/")]);
    await post("/admin/invites", { expiresOn: "", maxUses: "" });
    await post("/admin/invites", { expiresOn: "2026-05-01", maxUses: "" });
    const home = await (await admin.get("/admin/")).text();
    const inviteId = /invites\/([A-Za-z0-9-]+)\/revoke/.exec(home)?.[1] ?? "";
    pages.push(["/admin/", await admin.get("/admin/")]);
    await post(`/admin/invites/${inviteId}/revoke`, {});
    await post("/admin/invites/no-such-invite/revoke", {});
    expect(pages.map(([, response]) => response.status)).toEqual([200, 200, 422, 200, 303, 404]);
    for (const [path, response] of pages) await expectWorksUnderPrefix(admin, path, response);
  });

  it("answer a malformed or unknown plan ID with the admin's not-found page", async () => {
    const { admin } = await setup();
    await logIn(admin);
    const fields = hiddenFields(await (await admin.get("/admin/")).text());
    for (const id of ["unknown", "%2F%2Fevil.example", "A".repeat(22)]) {
      const shown = await admin.get(`/admin/plans/${id}`);
      expect(shown.status).toBe(404);
      expect(text(await shown.text())).toContain(en("admin.planNotFound"));
      const deleted = await admin.postForm(`/admin/plans/${id}/delete`, fields);
      expect(deleted.status).toBe(404);
      expect(deleted.headers.get("location")).toBeNull();
    }
  });

  it("find a plan by link or ID and show only its public details", async () => {
    const { admin, app } = await setup();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host, { exactDescription: "SENTINEL-exact" });
    await respondViaUi(new TestClient(app), planId, "SENTINEL-name", "joined");
    await logIn(admin);
    const fields = hiddenFields(await (await admin.get("/admin/")).text());
    for (const plan of [`https://runs.example.org/p/${planId}`, planId]) {
      const found = await admin.postForm("/admin/plans", { ...fields, plan });
      expect(found.headers.get("location")).toBe(`../admin/plans/${planId}`);
    }
    const page = await (await admin.get(`/admin/plans/${planId}`)).text();
    expect(page).toContain("Easy Sunday run");
    expect(page).toContain(en("admin.postedBy", { name: "Anna" }));
    expect(page).not.toContain("SENTINEL");
    const unknown = await admin.postForm("/admin/plans", { ...fields, plan: "no plan here" });
    expect(unknown.status).toBe(422);
  });

  it("delete a plan for everyone, without a template", async () => {
    const { admin, app, database } = await setup();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host, { keepAsTemplate: "1" });
    await respondViaUi(new TestClient(app), planId, "Ben", "joined");
    await logIn(admin);
    const fields = hiddenFields(await (await admin.get(`/admin/plans/${planId}`)).text());
    const deleted = await admin.postForm(`/admin/plans/${planId}/delete`, fields);
    expect(deleted.headers.get("location")).toBe("../../../admin/?deleted");
    expect(text(await (await admin.get("/admin/?deleted")).text())).toContain(en("admin.deleted"));
    expect((await host.get(`/p/${planId}`)).status).toBe(404);
    expect(database.sqlite.prepare("select count(*) from plan_templates").pluck().get()).toBe(0);
  });
});
