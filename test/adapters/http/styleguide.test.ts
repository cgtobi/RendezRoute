// The dev-only style guide (decision D72, plan 0.13 step 13b): only with ALLOW_INSECURE_DEV, never
// indexed, never linked, never on the admin listener, and it holds every section.
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";

const SECTIONS = [
  "sg-typography",
  "sg-buttons",
  "sg-inputs",
  "sg-choices",
  "sg-notices",
  "sg-folds",
  "sg-title",
  "sg-lines",
  "sg-plan-form",
  "sg-header-sheet",
  "sg-footer",
  "sg-badges",
  "sg-theme-colors",
];

const DEV = { ALLOW_INSECURE_DEV: "true", BASE_URL: "http://localhost:3000" };
const TOKEN = "admin-token-for-tests-0123456789abcdef";

async function guide(env: Record<string, string> = DEV) {
  const { app } = await createTestApp({ env });
  const response = await new TestClient(app).get("/styleguide");
  return { app, response, html: await response.text() };
}

describe("the style guide with ALLOW_INSECURE_DEV off", () => {
  it("answers 404 like any unknown path, with no section in it", async () => {
    const { app } = await createTestApp();
    const client = new TestClient(app);
    const unknown = await client.get("/no-such-page");
    const response = await client.get("/styleguide");
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).not.toContain("sg-");
    expect(unknown.status).toBe(404);
  });
});

describe("the style guide with ALLOW_INSECURE_DEV on", () => {
  it("renders every section exactly once", async () => {
    const { response, html } = await guide();
    expect(response.status).toBe(200);
    for (const id of SECTIONS) {
      expect(html.split(`id="${id}"`).length - 1).toBe(1);
      expect(html).toMatch(new RegExp(`<section[^>]*id="${id}"[^>]*>\\s*<h2`));
    }
  });

  it("is not indexed or stored", async () => {
    const { response, html } = await guide();
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('<meta name="robots" content="noindex"/>');
  });

  it("keeps the app's strict CSP and uses no inline style or script", async () => {
    const { response, html } = await guide();
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<style[\s>]/);
    // Scripts only with a src.
    expect([...html.matchAll(/<script\b[^>]*>/g)].every((m) => /\ssrc="/.test(m[0]))).toBe(true);
    expect(html).toContain('<link rel="stylesheet" href="/static/styleguide.css"/>');
    expect(html).toContain('<link rel="stylesheet" href="/static/app.css"/>');
  });

  it("shows the real create form in four states", async () => {
    const { html } = await guide();
    expect(html.split('class="plan-form"').length - 1).toBe(4);
    expect(html).toContain("fold fold-warning");
  });

  it("is not linked from the home or privacy pages", async () => {
    const { app } = await guide();
    const client = new TestClient(app);
    for (const path of ["/", "/privacy", "/new"]) {
      expect(await (await client.get(path)).text()).not.toContain("styleguide");
    }
  });

  it("is not on the admin listener", async () => {
    const test = await createTestApp({
      env: { ...DEV, ADMIN_TOKEN: TOKEN, ADMIN_PORT: "3001" },
    });
    if (test.adminApp === undefined) throw new Error("no admin app");
    const response = await new TestClient(test.adminApp).get("/styleguide");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("sg-");
  });
});
