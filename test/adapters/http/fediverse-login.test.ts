// Fediverse login through the web pages, with fake Mastodon servers (spec 7 Identity, 3.11 Account
// takeover; decisions D23, D24; plan v1.0 step 4b).
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi } from "../../support/plans.ts";
import { type FakeMastodonAccount, FakeMastodonServer } from "../../fakes/mastodon-server.ts";

const en = translator("en");
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');
const anna: FakeMastodonAccount = { id: "SENTINEL-109", username: "anna", display_name: "Anna" };

async function setup(env: Record<string, string> = {}) {
  const server = new FakeMastodonServer();
  const test = await createTestApp({
    env: { FEDIVERSE_LOGIN: "true", ...env },
    mastodon: [server],
  });
  return { ...test, server };
}

/** Sends the account page's fediverse form with this server. */
async function startLogin(client: TestClient, server: string) {
  const page = await (await client.get("/account")).text();
  const form = page.slice(page.indexOf('action="/login/fediverse"'));
  return client.postForm("/login/fediverse", { ...hiddenFields(form), server });
}

/** The path a callback URL leads to. */
const back = (callback: URL) => callback.pathname;

/** The provider's address on the "Continue" page. */
const continueUrl = (html: string) =>
  new URL((/<a class="button" href="([^"]+)"/.exec(html)?.[1] ?? "").replaceAll("&amp;", "&"));

async function logIn(client: TestClient, server: FakeMastodonServer, account = anna) {
  const started = await startLogin(client, "social.example");
  const callback = server.approve(continueUrl(await started.text()), account);
  return client.get(`${callback.pathname}${callback.search}`);
}

describe("fediverse login (spec 7 Identity)", () => {
  it("is off unless FEDIVERSE_LOGIN=true", async () => {
    const { app } = await createTestApp();
    const client = new TestClient(app);
    expect((await client.get("/account")).status).toBe(404);
    const _csrf = hiddenFields(await (await client.get("/")).text())._csrf ?? "";
    expect((await client.postForm("/login/fediverse", { _csrf, server: "x.example" })).status).toBe(
      404,
    );
  });

  it("asks for the server, then shows where the browser goes before sending it there", async () => {
    const { app, server, database } = await setup();
    const client = new TestClient(app);
    expect(await (await client.get("/")).text()).toContain('href="/account"');
    const page = text(await (await client.get("/account")).text());
    expect(page).toContain(en("account.fediverseHeading"));
    expect(page).toContain('name="server"');

    const started = await startLogin(client, "@anna@social.example");
    expect(started.status).toBe(200);
    expect(started.headers.get("cache-control")).toBe("no-store");
    expect(started.headers.get("referrer-policy")).toBe("no-referrer");
    const html = text(await started.text());
    expect(html).toContain(en("account.continue", { server: "social.example" }));
    const authorizationUrl = continueUrl(html);
    expect(authorizationUrl.origin).toBe("https://social.example");
    // This server's own callback; its key names no server.
    expect(authorizationUrl.searchParams.get("redirect_uri")).toMatch(
      /^https:\/\/runs\.example\.org\/login\/fediverse\/callback\/[0-9a-f]{32}$/,
    );
    expect(client.cookies.has("__Host-rr-login")).toBe(true);

    const back = await client.get(
      (({ pathname, search }) => `${pathname}${search}`)(server.approve(authorizationUrl, anna)),
    );
    expect(back.status).toBe(303);
    expect(back.headers.get("location")).toBe("/account?loggedIn");
    expect(text(await (await client.get("/account")).text())).toContain('value="Anna"');
    expect(server.revoked).toEqual(server.issued);
    expect(database.sqlite.prepare("select provider from identities").pluck().all()).toEqual([
      "fediverse",
    ]);
  });

  it("needs the CSRF token to start", async () => {
    const { app } = await setup();
    const forged = await new TestClient(app).postForm("/login/fediverse", {
      server: "social.example",
    });
    expect(forged.status).toBe(403);
  });

  it("says when the address is not a server, or not an accepted one, keeping what was typed", async () => {
    const { app } = await setup({ FEDIVERSE_LOGIN_SERVERS: "club.example" });
    const client = new TestClient(app);
    expect(text(await (await client.get("/account")).text())).toContain(
      en("account.fediverseServers", { servers: "club.example" }),
    );
    const invalid = await startLogin(client, "SENTINEL 10.0.0.1");
    expect(invalid.status).toBe(422);
    const html = text(await invalid.text());
    expect(html).toContain(en("field.server_invalid"));
    expect(html).toContain('value="SENTINEL 10.0.0.1"');
    const other = await startLogin(client, "social.example");
    expect(other.status).toBe(422);
    expect(text(await other.text())).toContain(en("field.server_not_allowed"));
  });

  it("says when the server cannot be reached; only typos are free under the rate limit", async () => {
    const { app, server } = await setup();
    const client = new TestClient(app);
    for (let i = 0; i < 12; i++)
      expect((await startLogin(client, "not a server")).status).toBe(422);
    server.down = true;
    for (let i = 0; i < 10; i++) {
      const started = await startLogin(client, "social.example");
      expect(started.status).toBe(502);
      expect(text(await started.text())).toContain(en("account.serverUnavailable"));
    }
    // A server that failed was still contacted: no free requests to servers someone picks.
    expect((await startLogin(client, "unknown.example")).status).toBe(429);
  });

  it("keeps codes, tokens, state and the account out of logs and plain storage", async () => {
    const { app, server, database, logs } = await setup();
    const client = new TestClient(app);
    const started = await startLogin(client, "social.example");
    const authorizationUrl = continueUrl(await started.text());
    const callback = server.approve(authorizationUrl, anna);
    await client.get(`${callback.pathname}${callback.search}`);
    // A second login, left unfinished: its app's ID and secret wait in the pending login.
    const other = new TestClient(app);
    const unfinished = continueUrl(await (await startLogin(other, "social.example")).text());
    expect(database.sqlite.prepare("select count(*) from pending_logins").pluck().get()).toBe(1);
    const token = server.requests.find((r) => r.path === "/oauth/token");
    const apps = [...server.apps.entries()].flatMap(([id, { secret }]) => [id, secret]);
    expect(apps).toHaveLength(4);
    expect(back(callback)).toMatch(/^\/login\/fediverse\/callback\/[0-9a-f]{32}$/);
    const secrets = [
      anna.id,
      callback.searchParams.get("code") ?? "",
      authorizationUrl.searchParams.get("state") ?? "",
      new URLSearchParams(token?.body).get("code_verifier") ?? "",
      server.issued[0] ?? "",
      unfinished.searchParams.get("state") ?? "",
      ...apps,
    ];
    for (const secret of secrets) expect(secret).not.toBe("");
    const stored = JSON.stringify([
      database.sqlite.prepare("select * from identities").all(),
      database.sqlite.prepare("select * from pending_logins").all(),
    ]);
    for (const secret of [...secrets, "social.example", "@anna"]) {
      expect(logs.join("\n")).not.toContain(secret);
      expect(stored).not.toContain(secret);
    }
  });

  it("refuses a callback opened in a browser that did not start the login", async () => {
    const { app, server, database } = await setup();
    const attacker = new TestClient(app);
    const started = await startLogin(attacker, "social.example");
    const callback = server.approve(continueUrl(await started.text()), { id: "1", username: "x" });
    const victim = new TestClient(app);
    expect((await victim.get(`${callback.pathname}${callback.search}`)).status).toBe(400);
    expect(database.sqlite.prepare("select count(*) from identities").pluck().get()).toBe(0);
  });

  it("is a way to log in for POSTING_MODE=logged_in", async () => {
    const { app, server } = await setup({ POSTING_MODE: "logged_in" });
    const client = new TestClient(app);
    expect(text(await (await client.get("/new")).text())).toContain(en("posting.loginNeeded"));
    await logIn(client, server);
    await createPlanViaUi(client);
  });

  it("is named in the privacy notice, with the login cookie", async () => {
    const { app } = await setup();
    const html = text(await (await new TestClient(app).get("/privacy")).text());
    expect(html).toContain(en("privacy.fediverse", { days: 30 }));
    expect(html).toContain(en("privacy.cookieLogin", { minutes: 10 }));
  });
});
