// The admin listener behind Home Assistant Ingress (decision D56; plan 0.10 step 10b): the
// Supervisor vouches for the user, no login, no cookie, a stateless CSRF token bound to the user
// (decision I74) plus a check of the fetch metadata that browsers send.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import type { Hono } from "hono";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields } from "../../support/client.ts";
import { createPlanViaUi } from "../../support/plans.ts";
import { TestClient } from "../../support/client.ts";

const en = translator("en");
const TRUSTED = "172.30.32.2";
const INGRESS = {
  ADMIN_INGRESS: "true",
  ADMIN_PORT: "3001",
  ADMIN_BIND: "0.0.0.0",
  ADMIN_INGRESS_SKIP_VERSION_CHECK: "true",
};
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');

async function setup(env: Record<string, string> = INGRESS) {
  const test = await createTestApp({ env });
  if (test.adminApp === undefined) throw new Error("no admin app");
  return { ...test, adminApp: test.adminApp };
}

/** A request as the Node server would see it: the socket's peer address is controllable. */
function from(app: Hono<never> | { request: Hono["request"] }, peer: string | undefined) {
  return (path: string, init: RequestInit = {}) =>
    app.request(
      path,
      { redirect: "manual", ...init },
      peer === undefined ? {} : { incoming: { socket: { remoteAddress: peer } } },
    );
}

const HOME = { "x-remote-user-groups": "system-users,system-admin", "x-remote-user-id": "user-a" };
/** What a browser's form post from the panel carries once Core has set no-referrer. */
const FORM = {
  "content-type": "application/x-www-form-urlencoded",
  "sec-fetch-site": "same-origin",
  origin: "null",
  host: "homeassistant.local:8123",
};

/** The token as the spec words it: HMAC(key, "ingress-csrf\n<id>\n<day>"), written out independently. */
function tokenFor(key: Buffer, userId: string, at: Date): string {
  return createHmac("sha256", key)
    .update(`ingress-csrf\n${userId}\n${at.toISOString().slice(0, 10)}`)
    .digest("base64url");
}
const DAY = 24 * 60 * 60 * 1000;

/** The Supervisor in front of the admin app, as a browser client for the TestClient helpers. */
function browser(adminApp: { request: Hono["request"] }, extra: Record<string, string> = {}) {
  const send = from(adminApp, TRUSTED);
  return new TestClient({
    request: (path, init) =>
      send(path, {
        ...init,
        headers: {
          ...HOME,
          ...(init?.method === undefined || init.method === "GET"
            ? {}
            : { "sec-fetch-site": "same-origin", origin: "null" }),
          ...extra,
          ...Object.fromEntries(new Headers(init?.headers)),
        },
      }),
  });
}

describe("who gets in", () => {
  it("serves the admin home to the trusted peer with system-admin", async () => {
    const { adminApp } = await setup();
    const response = await from(adminApp, TRUSTED)("/admin/", { headers: HOME });
    expect(response.status).toBe(200);
    expect(text(await response.text())).toContain(en("admin.title"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("takes the peer as an IPv4-mapped IPv6 address too", async () => {
    const { adminApp } = await setup();
    const response = await from(adminApp, `::ffff:${TRUSTED}`)("/admin/", { headers: HOME });
    expect(response.status).toBe(200);
  });

  it("refuses forged identity headers from any other peer, without saying why", async () => {
    const { adminApp } = await setup();
    const reference = await from(adminApp, "10.0.0.5")("/admin/", { headers: HOME });
    expect(reference.status).toBe(403);
    const html = await reference.text();
    // Plain text: no page, no instance name, no assets, no reason.
    expect(html).toBe("Forbidden");
    expect(reference.headers.get("content-type")).toMatch(/^text\/plain/);
    for (const peer of ["172.30.32.1", "172.30.33.2", "127.0.0.1", "::1", undefined]) {
      const response = await from(adminApp, peer)("/admin/", {
        headers: {
          ...HOME,
          "x-forwarded-for": TRUSTED,
          "x-ingress-path": "/api/hassio_ingress/abc",
          "x-remote-user-id": "someone",
        },
      });
      expect([peer, response.status]).toEqual([peer, 403]);
      expect(text(await response.text())).toBe(html);
    }
  });

  it("gives every path the same refusal to another peer", async () => {
    const { adminApp } = await setup();
    for (const path of [
      "/",
      "/admin",
      "/admin/login",
      "/admin/plans/abc",
      "/healthz",
      "/static/app.css",
      "/nope",
    ]) {
      const response = await from(adminApp, "10.0.0.5")(path, { headers: HOME });
      expect([path, response.status]).toEqual([path, 403]);
    }
  });

  it("explains the 403 to the trusted peer without system-admin", async () => {
    const { adminApp } = await setup();
    for (const headers of [
      {},
      { "x-remote-user-groups": "system-users" },
      { "x-remote-user-groups": "SYSTEM-ADMIN" },
      { "x-remote-user-groups": "system-administrator" },
    ]) {
      const response = await from(adminApp, TRUSTED)("/admin/", { headers });
      expect(response.status).toBe(403);
      expect(text(await response.text())).toContain(en("admin.ingressDenied"));
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("lets the trusted peer without system-admin load the assets for the explanation, nobody else", async () => {
    const { adminApp } = await setup();
    expect((await from(adminApp, TRUSTED)("/static/app.css", {})).status).toBe(200);
    expect((await from(adminApp, "10.0.0.5")("/static/app.css", { headers: HOME })).status).toBe(
      403,
    );
  });

  it("keeps every link and asset of the refusal and not-found pages relative", async () => {
    const { adminApp } = await setup();
    const prefix = "http://homeassistant.local:8123/api/hassio_ingress/abc";
    const cases: [string, Record<string, string>][] = [
      ["/", {}],
      ["/", { "x-remote-user-groups": "system-users" }],
      ["/nope/deeper", HOME],
      ["/nope/deeper/", HOME],
      ["/a//b", HOME],
      ["/nope", HOME],
    ];
    for (const [path, headers] of cases) {
      const response = await from(adminApp, TRUSTED)(path, { headers });
      expect([path, response.status === 403 || response.status === 404]).toEqual([path, true]);
      const html = await response.text();
      const requestUrl = new URL(prefix + path);
      const targets: string[] = [];
      for (const attribute of html.matchAll(/(?:href|src|action)="([^"]*)"/g)) {
        const value = attribute[1] ?? "";
        expect([path, value]).toEqual([
          path,
          expect.not.stringMatching(/^(\/|[a-z][a-z0-9+.-]*:)/i),
        ]);
        targets.push(new URL(value, requestUrl).href);
      }
      expect(targets.some((target) => target.startsWith(`${prefix}/static/app.css?v=`))).toBe(true);
      expect(targets).toContain(`${prefix}/admin/`);
    }
  });

  it("states what is needed", () => {
    expect(en("admin.ingressDenied")).toContain("2026.10.4");
    expect(en("admin.ingressDenied")).toMatch(/administrator/i);
  });

  it("never logs the Cookie or Authorization headers or the path", async () => {
    const { adminApp, logs } = await setup();
    await from(adminApp, TRUSTED)("/admin/plans/abcdefghijklmnopqrstuv?q=secret-query", {
      headers: {
        ...HOME,
        cookie: "ingress_session=SECRETCOOKIE",
        authorization: "Bearer SECRETAUTH",
      },
    });
    await from(adminApp, "10.0.0.5")("/admin/", {
      headers: { cookie: "ingress_session=SECRETCOOKIE" },
    });
    const all = logs.join("\n");
    expect(all).toContain("request");
    for (const secret of ["SECRETCOOKIE", "SECRETAUTH", "secret-query", "abcdefghijklmnopqrstuv"]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("no login, no session, no cookie", () => {
  it("redirects /admin/login, GET and POST, to the admin home with a relative address", async () => {
    const { adminApp, adminCsrfKey, clock } = await setup();
    const csrf = tokenFor(adminCsrfKey, "user-a", clock.now());
    const send = from(adminApp, TRUSTED);
    const get = await send("/admin/login", { headers: HOME });
    expect(get.status).toBe(303);
    expect(get.headers.get("location")).toBe("../admin/");
    const post = await send("/admin/login", {
      method: "POST",
      headers: { ...HOME, ...FORM },
      body: new URLSearchParams({ token: "x", _csrf: csrf }).toString(),
    });
    expect(post.status).toBe(303);
    expect(post.headers.get("location")).toBe("../admin/");
  });

  it("has no logout page and no log out button", async () => {
    const { adminApp, adminCsrfKey, clock } = await setup();
    const send = from(adminApp, TRUSTED);
    const logout = await send("/admin/logout", {
      method: "POST",
      headers: { ...HOME, ...FORM },
      body: new URLSearchParams({
        _csrf: tokenFor(adminCsrfKey, "user-a", clock.now()),
      }).toString(),
    });
    expect(logout.status).toBe(404);
    const html = await (await send("/admin/", { headers: HOME })).text();
    expect(html).not.toContain("logout");
    expect(html).not.toContain(en("admin.logout"));
  });

  it("sets no cookie on any response", async () => {
    const { adminApp, database, adminCsrfKey, clock } = await setup({
      ...INGRESS,
      POSTING_MODE: "invite",
    });
    const csrf = tokenFor(adminCsrfKey, "user-a", clock.now());
    const send = from(adminApp, TRUSTED);
    const responses: [string, Response][] = [];
    const record = async (label: string, promise: Response | Promise<Response>) =>
      responses.push([label, await promise]);
    await record("home", send("/admin/", { headers: HOME }));
    await record("root", send("/", { headers: HOME }));
    await record("login", send("/admin/login", { headers: HOME }));
    await record(
      "language page",
      send("/admin/", { headers: { ...HOME, "accept-language": "de" } }),
    );
    await record("static", send("/static/app.css", { headers: HOME }));
    await record("not found", send("/admin/plans/abcdefghijklmnopqrstuv", { headers: HOME }));
    await record("denied", send("/admin/", {}));
    await record("other peer", from(adminApp, "10.0.0.5")("/admin/", { headers: HOME }));
    await record("blocked post", send("/admin/plans", { method: "POST", headers: HOME, body: "" }));
    await record(
      "find plan",
      send("/admin/plans", {
        method: "POST",
        headers: { ...HOME, ...FORM },
        body: new URLSearchParams({ plan: "nonsense", _csrf: csrf }).toString(),
      }),
    );
    const home = await (await send("/admin/", { headers: HOME })).text();
    const fields = hiddenFields(home.slice(home.indexOf('id="invites"')));
    await record(
      "invite created",
      send("/admin/invites", {
        method: "POST",
        headers: { ...HOME, ...FORM },
        body: new URLSearchParams({ ...fields, expiresOn: "", maxUses: "" }).toString(),
      }),
    );
    for (const [label, response] of responses) {
      expect([label, response.headers.getSetCookie()]).toEqual([label, []]);
    }
    expect(database.sqlite.prepare("select count(*) from invites").pluck().get()).toBe(1);
  });

  it("asks nothing from the Cookie header: a session or csrf cookie is no way in", async () => {
    const { adminApp } = await setup();
    const response = await from(adminApp, TRUSTED)("/admin/", {
      headers: { cookie: "rr-admin-split=1.x; rr-admin-csrf=y" },
    });
    expect(response.status).toBe(403);
  });
});

describe("the stateless CSRF token and fetch metadata", () => {
  async function csrfSetup() {
    const test = await setup();
    const { adminApp, adminCsrfKey, publicCsrfKey, clock } = test;
    const token = (userId = "user-a", at: Date = clock.now(), key = adminCsrfKey) =>
      tokenFor(key, userId, at);
    /** A form post to the plan lookup: 422 (plan not found) means it got past the guards. */
    const post = (
      fields: Record<string, string> | undefined,
      headers: Record<string, string>,
      user = "user-a",
    ) =>
      from(adminApp, TRUSTED)("/admin/plans", {
        method: "POST",
        headers: {
          ...HOME,
          "x-remote-user-id": user,
          "content-type": FORM["content-type"],
          host: "homeassistant.local:8123",
          ...headers,
        },
        body: new URLSearchParams({ plan: "nonsense", ...fields }).toString(),
      });
    return { ...test, token, post, adminApp, publicCsrfKey };
  }
  const SAME = { "sec-fetch-site": "same-origin", origin: "null" };
  const LAN = { origin: "null" };

  it("accepts a valid token with same-origin metadata", async () => {
    const { post, token } = await csrfSetup();
    expect((await post({ _csrf: token() }, SAME)).status).toBe(422);
  });

  it("accepts a valid token over plain http to a LAN host: no Sec-Fetch-Site, Origin null", async () => {
    const { post, token } = await csrfSetup();
    expect((await post({ _csrf: token() }, LAN)).status).toBe(422);
    expect((await post({ _csrf: token() }, {})).status).toBe(422);
  });

  it("accepts an Origin with the request's Host, and null", async () => {
    const { post, token } = await csrfSetup();
    for (const origin of [
      "null",
      "http://homeassistant.local:8123",
      "https://HomeAssistant.local:8123",
    ]) {
      expect([origin, (await post({ _csrf: token() }, { origin })).status]).toEqual([origin, 422]);
    }
  });

  it("refuses a valid token when Sec-Fetch-Site is anything but same-origin", async () => {
    const { post, token } = await csrfSetup();
    for (const site of ["cross-site", "same-site", "none", "", "Same-Origin x"]) {
      const response = await post({ _csrf: token() }, { ...LAN, "sec-fetch-site": site });
      expect([site, response.status]).toEqual([site, 403]);
    }
  });

  it("refuses a valid token with an Origin of another host, port or nonsense", async () => {
    const { post, token } = await csrfSetup();
    for (const origin of [
      "https://evil.example",
      "http://homeassistant.local:8124",
      "http://homeassistant.local",
      "homeassistant.local:8123",
      "",
    ]) {
      const response = await post({ _csrf: token() }, { "sec-fetch-site": "same-origin", origin });
      expect([origin, response.status]).toEqual([origin, 403]);
    }
  });

  it("refuses a post without a token, even with perfect metadata", async () => {
    const { post } = await csrfSetup();
    expect((await post({}, SAME)).status).toBe(403);
    expect((await post({ _csrf: "" }, SAME)).status).toBe(403);
    expect((await post({}, LAN)).status).toBe(403);
  });

  it("refuses a wrong token, a truncated one and a token of another user", async () => {
    const { post, token } = await csrfSetup();
    expect((await post({ _csrf: "x".repeat(43) }, SAME)).status).toBe(403);
    expect((await post({ _csrf: token().slice(1) }, SAME)).status).toBe(403);
    expect((await post({ _csrf: `${token()}A` }, SAME)).status).toBe(403);
    expect((await post({ _csrf: token("user-b") }, SAME)).status).toBe(403);
  });

  it("binds the token to the user: A's token fails for B and the other way round", async () => {
    const { post, token } = await csrfSetup();
    expect((await post({ _csrf: token("user-a") }, SAME, "user-a")).status).toBe(422);
    expect((await post({ _csrf: token("user-a") }, SAME, "user-b")).status).toBe(403);
    expect((await post({ _csrf: token("user-b") }, SAME, "user-b")).status).toBe(422);
    expect((await post({ _csrf: token("user-b") }, SAME, "user-a")).status).toBe(403);
  });

  it("accepts yesterday's token, not the one of two days ago nor tomorrow's", async () => {
    const { post, token, clock } = await csrfSetup();
    const now = clock.now();
    expect(
      (await post({ _csrf: token("user-a", new Date(now.getTime() - DAY)) }, SAME)).status,
    ).toBe(422);
    expect(
      (await post({ _csrf: token("user-a", new Date(now.getTime() - 2 * DAY)) }, SAME)).status,
    ).toBe(403);
    expect(
      (await post({ _csrf: token("user-a", new Date(now.getTime() + DAY)) }, SAME)).status,
    ).toBe(403);
  });

  it("follows the clock at the UTC day change", async () => {
    const { post, token, clock } = await csrfSetup();
    clock.set("2026-06-01T23:59:00Z");
    const evening = token();
    expect((await post({ _csrf: evening }, SAME)).status).toBe(422);
    clock.set("2026-06-02T00:01:00Z");
    expect((await post({ _csrf: evening }, SAME)).status).toBe(422);
    clock.set("2026-06-03T00:01:00Z");
    expect((await post({ _csrf: evening }, SAME)).status).toBe(403);
  });

  it("refuses a token made with the public app's CSRF key", async () => {
    const { post, token, publicCsrfKey } = await csrfSetup();
    expect((await post({ _csrf: token("user-a", undefined, publicCsrfKey) }, SAME)).status).toBe(
      403,
    );
  });

  it("refuses a token minted by the public app's pages", async () => {
    const { post, app } = await csrfSetup();
    const fields = await new TestClient(app).hiddenFields("/privacy");
    expect(fields["_csrf"]).toBeDefined();
    expect((await post({ _csrf: fields["_csrf"] ?? "" }, SAME)).status).toBe(403);
  });

  it("needs the token on PUT, PATCH and DELETE too", async () => {
    const { adminApp, token } = await csrfSetup();
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const bare = await from(adminApp, TRUSTED)("/admin/plans", {
        method,
        headers: { ...HOME, ...SAME },
      });
      expect([method, bare.status]).toEqual([method, 403]);
      const withToken = await from(adminApp, TRUSTED)("/admin/plans", {
        method,
        headers: { ...HOME, ...SAME, "content-type": FORM["content-type"] },
        body: new URLSearchParams({ _csrf: token() }).toString(),
      });
      // Past the guard, there is no such route.
      expect([method, withToken.status]).toEqual([method, 404]);
    }
  });

  it("refuses a request without X-Remote-User-Id with the explanation, GET and POST", async () => {
    const { adminApp, adminCsrfKey, clock } = await csrfSetup();
    const noId = { "x-remote-user-groups": HOME["x-remote-user-groups"] };
    const get = await from(adminApp, TRUSTED)("/admin/", { headers: noId });
    expect(get.status).toBe(403);
    expect(text(await get.text())).toContain(en("admin.ingressDenied"));
    const post = await from(adminApp, TRUSTED)("/admin/plans", {
      method: "POST",
      headers: { ...noId, ...FORM },
      body: new URLSearchParams({
        plan: "x",
        _csrf: tokenFor(adminCsrfKey, "", clock.now()),
      }).toString(),
    });
    expect(post.status).toBe(403);
    expect(text(await post.text())).toContain(en("admin.ingressDenied"));
  });

  it("leaves GET and HEAD alone", async () => {
    const { adminApp } = await csrfSetup();
    for (const method of ["GET", "HEAD"]) {
      const response = await from(adminApp, TRUSTED)("/admin/", {
        method,
        headers: { ...HOME, "sec-fetch-site": "cross-site" },
      });
      expect([method, response.status]).toEqual([method, 200]);
    }
  });

  it("refuses a post from another peer however well it is formed, a forged token included", async () => {
    const { adminApp, token } = await csrfSetup();
    const response = await from(adminApp, "10.0.0.5")("/admin/plans", {
      method: "POST",
      headers: { ...HOME, ...FORM },
      body: new URLSearchParams({ plan: "x", _csrf: token() }).toString(),
    });
    expect(response.status).toBe(403);
    expect(text(await response.text())).not.toContain(en("admin.ingressDenied"));
  });

  it("puts the real token in the forms, bound to the user and day, and no cookie", async () => {
    const { adminApp, token } = await csrfSetup();
    const page = await from(adminApp, TRUSTED)("/admin/", { headers: HOME });
    expect(hiddenFields(await page.text())["_csrf"]).toBe(token());
    const other = await from(adminApp, TRUSTED)("/admin/", {
      headers: { ...HOME, "x-remote-user-id": "user-b" },
    });
    expect(hiddenFields(await other.text())["_csrf"]).toBe(token("user-b"));
    expect(page.headers.getSetCookie()).toEqual([]);
  });
});

describe("the admin pages in Ingress mode", () => {
  it("lists reports, resolves them, and deletes plans", async () => {
    const { adminApp, app, database } = await setup();
    const admin = browser(adminApp);
    const formFields = async (path: string) => hiddenFields(await (await admin.get(path)).text());
    const { planId } = await createPlanViaUi(new TestClient(app));
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
    const lookup = await admin.postForm("/admin/plans", {
      ...(await formFields("/admin/")),
      plan: planId,
    });
    expect(lookup.headers.get("location")).toBe(`../admin/plans/${planId}`);
    const deleted = await admin.postForm(
      `/admin/plans/${planId}/delete`,
      await formFields(`/admin/plans/${planId}`),
    );
    expect(deleted.headers.get("location")).toBe("../../../admin/?deleted");
    expect((await new TestClient(app).get(`/p/${planId}`)).status).toBe(404);
  });

  it("creates and revokes invite links, and an invite works on the public app", async () => {
    const { adminApp, app, database } = await setup({ ...INGRESS, POSTING_MODE: "invite" });
    const admin = browser(adminApp);
    const home = await (await admin.get("/admin/")).text();
    const fields = hiddenFields(home.slice(home.indexOf('id="invites"')));
    const created = await admin.postForm("/admin/invites", {
      ...fields,
      expiresOn: "",
      maxUses: "",
    });
    expect(created.status).toBe(200);
    const link = /https:\/\/runs\.example\.org(\/i\/[A-Za-z0-9_-]{43})/.exec(await created.text());
    expect(link?.[1]).toBeDefined();
    const person = new TestClient(app);
    const invitePage = await person.get(link?.[1] ?? "");
    expect(
      (await person.postForm("/i", hiddenFields(await invitePage.text()))).status,
    ).toBeLessThan(400);

    const after = await (await admin.get("/admin/")).text();
    const revoke = /action="\.\.(\/admin\/invites\/[^"]+\/revoke)"/.exec(after)?.[1];
    expect((await admin.postForm(revoke ?? "", hiddenFields(after))).status).toBe(303);
    expect(
      database.sqlite
        .prepare("select count(*) from invites where revoked_at is null")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it("answers only with relative redirects", async () => {
    const { adminApp, adminCsrfKey, clock } = await setup({ ...INGRESS, POSTING_MODE: "invite" });
    const csrf = tokenFor(adminCsrfKey, "user-a", clock.now());
    const send = from(adminApp, TRUSTED);
    const locations: string[] = [];
    for (const [path, method] of [
      ["/", "GET"],
      ["/admin", "GET"],
      ["/admin/login", "GET"],
      ["/admin/login", "POST"],
      ["/admin/plans", "POST"],
      ["/admin/plans/abcdefghijklmnopqrstuv/delete", "POST"],
      ["/admin/invites/00000000-0000-0000-0000-000000000000/revoke", "POST"],
    ] as const) {
      const response = await send(path, {
        method,
        headers: { ...HOME, ...(method === "POST" ? FORM : {}) },
        ...(method === "POST" ? { body: `plan=abcdefghijklmnopqrstuv&token=x&_csrf=${csrf}` } : {}),
      });
      const location = response.headers.get("location");
      if (location !== null) locations.push(location);
    }
    expect(locations.length).toBeGreaterThan(3);
    for (const location of locations) {
      expect(location).not.toMatch(/^\//);
      expect(location).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
      expect(location).not.toMatch(/^\/\//);
    }
  });

  it("has only relative links and assets on its pages", async () => {
    const { adminApp } = await setup({ ...INGRESS, POSTING_MODE: "invite" });
    const html = await (await from(adminApp, TRUSTED)("/admin/", { headers: HOME })).text();
    for (const attribute of html.matchAll(/(?:href|src|action)="([^"]*)"/g)) {
      const value = attribute[1] ?? "";
      expect(value).not.toMatch(/^(\/|[a-z][a-z0-9+.-]*:)/i);
    }
  });

  it("does not compress its responses", async () => {
    const { adminApp } = await setup();
    const response = await from(adminApp, TRUSTED)("/admin/", {
      headers: { ...HOME, "accept-encoding": "gzip, br" },
    });
    expect(response.headers.get("content-encoding")).toBeNull();
  });
});

describe("frame-ancestors", () => {
  const ancestors = (response: Response) =>
    /frame-ancestors ([^;]+)/.exec(response.headers.get("content-security-policy") ?? "")?.[1];

  it("is 'self' on every admin response in Ingress mode, refusals included", async () => {
    const { adminApp } = await setup();
    const send = from(adminApp, TRUSTED);
    for (const response of [
      await send("/admin/", { headers: HOME }),
      await send("/admin/", {}),
      await from(adminApp, "10.0.0.5")("/admin/", { headers: HOME }),
      await send("/admin/login", { headers: HOME }),
      await send("/static/app.css", { headers: HOME }),
      await send("/nope", { headers: HOME }),
      await send("/admin/plans", { method: "POST", headers: HOME }),
    ]) {
      expect(ancestors(response)).toBe("'self'");
    }
  });

  it("stays 'none' on the public app and on the token-mode admin app", async () => {
    const ingress = await setup();
    expect(ancestors(await ingress.app.request("/privacy"))).toBe("'none'");
    const token = await createTestApp({
      env: { ADMIN_TOKEN: "admin-token-for-tests-0123456789abcdef", ADMIN_PORT: "3001" },
    });
    expect(ancestors(await token.app.request("/privacy"))).toBe("'none'");
    if (token.adminApp === undefined) throw new Error("no admin app");
    expect(ancestors(await token.adminApp.request("/admin/login"))).toBe("'none'");
    const unsplit = await createTestApp({
      env: { ADMIN_TOKEN: "admin-token-for-tests-0123456789abcdef" },
    });
    expect(ancestors(await unsplit.app.request("/admin/login"))).toBe("'none'");
  });
});

describe("the public app when Ingress is the admin", () => {
  it("knows an admin exists: reports are on, /admin is 404", async () => {
    const { app } = await setup();
    const { planId } = await createPlanViaUi(new TestClient(app));
    const page = await new TestClient(app).get(`/p/${planId}`);
    expect(await page.text()).toContain(`href="/p/${planId}/report"`);
    expect((await app.request("/admin/")).status).toBe(404);
  });

  it("says nothing about an admin cookie on the privacy page, as there is none", async () => {
    const { app } = await setup();
    const html = text(await (await app.request("/privacy")).text());
    expect(html).toContain(en("privacy.reports"));
    expect(html).not.toContain(en("privacy.cookieAdmin", { hours: 12 }));
  });
});
