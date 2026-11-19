// The visitor's own palette (decision 005): a cookie like language, units and theme.
import { describe, expect, it } from "vite-plus/test";
import { assetUrl } from "../../../src/adapters/in/http/asset-url.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { createPlanViaUi } from "../../support/plans.ts";

const TOKEN = "admin-token-for-tests-0123456789abcdef";

async function setup(env: Record<string, string> = {}) {
  const test = await createTestApp({ env });
  return { ...test, client: new TestClient(test.app) };
}

async function choosePalette(client: TestClient, palette: string, returnTo = "/new") {
  const hidden = await client.hiddenFields("/new");
  return client.postForm("/palette", { ...hidden, palette, returnTo });
}

const paletteCookie = (response: Response) =>
  response.headers.getSetCookie().find((c) => c.startsWith("__Host-rr-palette="));

describe("palette choice (decision 005)", () => {
  it("is the site default without a cookie: no cookie, no attribute, no link", async () => {
    const { client } = await setup();
    const response = await client.get("/new");
    const page = await response.text();
    expect(page).not.toContain("data-palette");
    expect(page).not.toContain("palettes/");
    expect(response.headers.getSetCookie().join()).not.toContain("rr-palette");
  });

  it("is chosen with a menu form that works without JavaScript", async () => {
    const { client } = await setup();
    const page = await (await client.get("/new")).text();
    const form = /<form[^>]*action="\/palette"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).toContain('name="_csrf"');
    expect(form).toContain('name="returnTo" value="/new"');
    expect(form).toContain("Style");
    expect(form).toContain('<option value="site" selected="">Site default</option>');
    expect(form).toContain('<option value="default">Default</option>');
    expect(form).toContain('<option value="mono">Mono</option>');
    expect(form).toContain('<option value="bold">Bold</option>');
    expect(form).toContain('<option value="archivo">Archivo</option>');
    // Exactly the shipped palettes, in their order, after the two defaults.
    expect([...form.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1])).toEqual([
      "site",
      "default",
      "mono",
      "bold",
      "archivo",
    ]);
    expect(form).toContain("data-auto-submit");
    expect(form).toContain("<button");
    // The fourth row, after language, units and theme.
    const order = ["/language", "/units", "/theme", "/palette"].map((a) =>
      page.indexOf(`action="${a}"`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i > 0)).toBe(true);
  });

  it("is stored in its own cookie holding only the palette id", async () => {
    const { client } = await setup();
    const response = await choosePalette(client, "bold");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/new");
    expect(paletteCookie(response)).toBe(
      "__Host-rr-palette=bold; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(paletteCookie(await choosePalette(client, "default"))).toBe(
      "__Host-rr-palette=default; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("removes the cookie when Site default is chosen", async () => {
    const { client } = await setup();
    await choosePalette(client, "mono");
    const response = await choosePalette(client, "site");
    expect(response.status).toBe(303);
    const cookie = paletteCookie(response) ?? "";
    expect(cookie).toMatch(/^__Host-rr-palette=;/);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Secure");
    expect(await (await client.get("/new")).text()).not.toContain("data-palette");
  });

  it("applies the visitor's palette: attribute, versioned link after app.css, selected option", async () => {
    const { client } = await setup();
    await choosePalette(client, "bold");
    const page = await (await client.get("/new")).text();
    expect(page).toMatch(/<html [^>]*data-palette="bold"/);
    const link = `<link rel="stylesheet" href="${assetUrl("/", "palettes/bold.css")}"`;
    expect(page).toContain(link);
    expect(page.indexOf(link)).toBeGreaterThan(page.indexOf('href="/static/app.css?v='));
    expect(page).toContain('<option value="bold" selected="">Bold</option>');
    expect(page).not.toContain('<option value="site" selected');
  });

  it("beats the instance palette, including a visitor's choice of default", async () => {
    const { client } = await setup({ PALETTE: "bold" });
    expect(await (await client.get("/new")).text()).toContain('data-palette="bold"');
    await choosePalette(client, "mono");
    const mono = await (await client.get("/new")).text();
    expect(mono).toContain('data-palette="mono"');
    expect(mono).not.toContain("palettes/bold.css");
    await choosePalette(client, "default");
    const plain = await (await client.get("/new")).text();
    expect(plain).not.toContain("data-palette");
    expect(plain).not.toContain("palettes/");
    expect(plain).toContain('<option value="default" selected="">Default</option>');
    await choosePalette(client, "site");
    expect(await (await client.get("/new")).text()).toContain('data-palette="bold"');
  });

  it("ignores a cookie with an unknown value and falls back to the instance palette", async () => {
    const { client } = await setup({ PALETTE: "mono" });
    client.cookies.set("__Host-rr-palette", "pink");
    const page = await (await client.get("/new")).text();
    expect(page).toContain('data-palette="mono"');
    expect(page).toContain('<option value="site" selected="">Site default (Mono)</option>');
    // A valid cookie wins; the read-side cookie name is pinned without the write side.
    client.cookies.set("__Host-rr-palette", "bold");
    const chosen = await (await client.get("/new")).text();
    expect(chosen).toContain('data-palette="bold"');
    expect(chosen).toContain('<option value="bold" selected="">Bold</option>');
  });

  it("rejects unknown palettes and requests without the CSRF token", async () => {
    const { client } = await setup();
    const hidden = await client.hiddenFields("/new");
    expect((await client.postForm("/palette", { ...hidden, palette: "pink" })).status).toBe(400);
    expect((await client.postForm("/palette", { ...hidden, palette: "" })).status).toBe(400);
    expect((await client.postForm("/palette", { palette: "bold" })).status).toBe(403);
  });

  it("returns only to local paths and never to a secret link", async () => {
    const { client, app } = await setup();
    for (const returnTo of ["https://evil.example/", "//evil.example/", "/a/abc", "/m/abc"]) {
      const response = await choosePalette(client, "bold", returnTo);
      expect(response.headers.get("location")).toBe("/");
    }
    const { hostPath } = await createPlanViaUi(client);
    const page = await (await new TestClient(app).get(hostPath)).text();
    const form = /<form[^>]*action="\/palette"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).toContain('name="returnTo" value="/"');
  });

  it("is ignored by the admin listener, which keeps the default colours", async () => {
    const test = await createTestApp({
      env: { PALETTE: "bold", ADMIN_TOKEN: TOKEN, ADMIN_PORT: "3001" },
    });
    if (test.adminApp === undefined) throw new Error("no admin app");
    const response = await test.adminApp.request("/admin/login", {
      headers: { cookie: "__Host-rr-palette=mono; rr-palette=mono" },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("data-palette");
    expect(html).not.toContain("palettes/");
  });

  it("uses a non-__Host cookie without Secure in development mode, on set and on delete", async () => {
    const test = await createTestApp({
      env: { BASE_URL: "http://localhost:3000", ALLOW_INSECURE_DEV: "true" },
    });
    const client = new TestClient(test.app);
    const set = await choosePalette(client, "mono");
    const setCookie = set.headers.getSetCookie().find((c) => c.startsWith("rr-palette=")) ?? "";
    expect(setCookie).toBe("rr-palette=mono; Max-Age=34560000; Path=/; HttpOnly; SameSite=Lax");
    const cleared = await choosePalette(client, "site");
    const deleted = cleared.headers.getSetCookie().find((c) => c.startsWith("rr-palette=")) ?? "";
    expect(deleted).toMatch(/^rr-palette=;/);
    expect(deleted).toContain("Max-Age=0");
    expect(deleted).not.toContain("Secure");
  });
});

describe("caching of pages that depend on the palette cookie (decision 005)", () => {
  it("marks every HTML response Vary: Cookie and never makes it publicly cacheable", async () => {
    const { client, app } = await setup();
    const { hostPath, planId } = await createPlanViaUi(client);
    const planPath = `/p/${planId}`;
    await choosePalette(client, "bold");
    const paths = [
      ["/", 200],
      ["/new", 200],
      ["/privacy", 200],
      ["/nearby", 200],
      ["/my-data", 200],
      ["/no-such-page", 404],
      [planPath, 200],
    ] as const;
    for (const [path, status] of paths) {
      const response = await new TestClient(app).get(path);
      expect(`${path}: ${response.status}`).toBe(`${path}: ${status}`);
      expect(response.headers.get("content-type") ?? "").toMatch(/^text\/html/);
      expect(`${path}: ${response.headers.get("vary")}`).toMatch(/Cookie/i);
      expect(response.headers.get("cache-control") ?? "").not.toMatch(/public|s-maxage/i);
    }
    // The host's own page too, with the palette cookie sent.
    await client.get(hostPath); // the secret link sets the device cookie and redirects
    const own = await client.get(`/p/${planId}/host`);
    expect(own.status).toBe(200);
    expect(own.headers.get("vary") ?? "").toMatch(/Cookie/i);
    expect(own.headers.get("cache-control") ?? "").not.toMatch(/public|s-maxage/i);
  });

  it("does not hand one visitor's palette to another visitor", async () => {
    const { client, app } = await setup();
    const { planId } = await createPlanViaUi(client);
    const planPath = `/p/${planId}`;
    await choosePalette(client, "bold");
    const mine = await client.get(planPath);
    expect(await mine.text()).toContain('data-palette="bold"');
    const other = await new TestClient(app).get(planPath);
    expect(await other.text()).not.toContain("data-palette");
    // What tells a cache apart is the Cookie header, which Vary names.
    expect(other.headers.get("vary") ?? "").toMatch(/Cookie/i);
  });

  it("serves the palette stylesheet without any cookie dependence", async () => {
    const { app } = await setup();
    const response = await new TestClient(app).get(assetUrl("/", "palettes/bold.css"));
    expect(response.headers.get("vary") ?? "").not.toMatch(/Cookie/i);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
