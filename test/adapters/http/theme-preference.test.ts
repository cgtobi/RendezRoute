import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { createPlanViaUi } from "../../support/plans.ts";

async function setup() {
  const test = await createTestApp();
  return { ...test, client: new TestClient(test.app) };
}

async function chooseTheme(client: TestClient, theme: string, returnTo = "/new") {
  const hidden = await client.hiddenFields("/new");
  return client.postForm("/theme", { ...hidden, theme, returnTo });
}

const themeCookie = (response: Response) =>
  response.headers.getSetCookie().find((c) => c.startsWith("__Host-rr-theme="));

describe("theme (decisions D64, I82)", () => {
  it("follows the system by default: no cookie, no attribute", async () => {
    const { client } = await setup();
    const response = await client.get("/new");
    const page = await response.text();
    expect(page).toContain('<html lang="en">');
    expect(page).not.toContain("data-theme");
    expect(response.headers.getSetCookie().join()).not.toContain("rr-theme");
  });

  it("is chosen with a menu form that works without JavaScript", async () => {
    const { client } = await setup();
    const page = await (await client.get("/new")).text();
    const form = /<form[^>]*action="\/theme"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).toContain('name="_csrf"');
    expect(form).toContain('name="returnTo" value="/new"');
    expect(form).toContain("Theme");
    expect(form).toContain('<option value="system" selected="">System</option>');
    expect(form).toContain('<option value="light">Light</option>');
    expect(form).toContain('<option value="dark">Dark</option>');
    expect(form).toContain("<button");
  });

  it("is stored in its own cookie holding only the choice", async () => {
    const { client } = await setup();
    const response = await chooseTheme(client, "dark");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/new");
    expect(themeCookie(response)).toBe(
      "__Host-rr-theme=dark; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    const light = await chooseTheme(client, "light");
    expect(themeCookie(light)).toBe(
      "__Host-rr-theme=light; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("removes the cookie when System is chosen", async () => {
    const { client } = await setup();
    await chooseTheme(client, "dark");
    const response = await chooseTheme(client, "system");
    expect(response.status).toBe(303);
    const cookie = themeCookie(response) ?? "";
    expect(cookie).toMatch(/^__Host-rr-theme=;/);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    const page = await (await client.get("/new")).text();
    expect(page).not.toContain("data-theme");
  });

  it("sets the attribute on the page only for a chosen theme, next to lang", async () => {
    const { client } = await setup();
    await chooseTheme(client, "dark");
    const dark = await (await client.get("/new")).text();
    expect(dark).toContain('<html lang="en" data-theme="dark">');
    expect(dark).toContain('<option value="dark" selected="">Dark</option>');
    await chooseTheme(client, "light");
    expect(await (await client.get("/new")).text()).toContain(
      '<html lang="en" data-theme="light">',
    );
  });

  it("ignores a cookie with an unknown value", async () => {
    const { client } = await setup();
    client.cookies.set("__Host-rr-theme", "pink");
    expect(await (await client.get("/new")).text()).not.toContain("data-theme");
  });

  it("rejects unknown themes and requests without the CSRF token", async () => {
    const { client } = await setup();
    const hidden = await client.hiddenFields("/new");
    expect((await client.postForm("/theme", { ...hidden, theme: "pink" })).status).toBe(400);
    expect((await client.postForm("/theme", { theme: "dark" })).status).toBe(403);
  });

  it("returns only to local paths", async () => {
    const { client } = await setup();
    for (const returnTo of ["https://evil.example/", "//evil.example/", "/\\evil.example"]) {
      const response = await chooseTheme(client, "dark", returnTo);
      expect(response.headers.get("location")).toBe("/");
    }
  });

  it("never returns to a secret link", async () => {
    const { client, app } = await setup();
    for (const returnTo of ["/a/abc", "/m/abc", "/c/abc"]) {
      const response = await chooseTheme(client, "dark", returnTo);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
    }
    // Nor does a page at a secret link offer one.
    const { hostPath } = await createPlanViaUi(client);
    const page = await (await new TestClient(app).get(hostPath)).text();
    const form = /<form[^>]*action="\/theme"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).toContain('name="returnTo" value="/"');
  });

  it("is ignored by the admin listener, which always follows the system", async () => {
    const test = await createTestApp({
      env: { ADMIN_TOKEN: "admin-token-for-tests-0123456789abcdef", ADMIN_PORT: "3001" },
    });
    if (test.adminApp === undefined) throw new Error("no admin app");
    const response = await test.adminApp.request("/admin/login", {
      headers: { cookie: "__Host-rr-theme=dark; rr-theme=dark" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("data-theme");
  });

  it("uses a non-__Host cookie without Secure in development mode, on set and on delete", async () => {
    const test = await createTestApp({
      env: { BASE_URL: "http://localhost:3000", ALLOW_INSECURE_DEV: "true" },
    });
    const client = new TestClient(test.app);
    const set = await chooseTheme(client, "dark");
    const setCookie = set.headers.getSetCookie().find((c) => c.startsWith("rr-theme=")) ?? "";
    expect(setCookie).toBe("rr-theme=dark; Max-Age=34560000; Path=/; HttpOnly; SameSite=Lax");
    const cleared = await chooseTheme(client, "system");
    const deleteCookie =
      cleared.headers.getSetCookie().find((c) => c.startsWith("rr-theme=")) ?? "";
    expect(deleteCookie).toMatch(/^rr-theme=;/);
    expect(deleteCookie).toContain("Max-Age=0");
    expect(deleteCookie).not.toContain("Secure");
  });
});
