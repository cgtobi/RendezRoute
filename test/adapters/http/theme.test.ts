import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

async function setup(colors = { primaryColor: "#0f9d58", secondaryColor: "#FFEB3B" }) {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host, colors);
  return { ...test, host, planId, newClient: () => new TestClient(test.app) };
}

const VALUE = /^(#[0-9A-F]{6}|color-mix\(in srgb, #[0-9A-F]{6} \d{1,2}%, var\(--bg\)\))$/;

describe("per-plan theme stylesheet (spec 3.1 Plan colors)", () => {
  it("defines the plan's colors, readable text colors and tints as custom properties", async () => {
    const { planId, newClient } = await setup();
    const response = await newClient().get(`/p/${planId}/theme.css`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const css = await response.text();
    expect(css).toContain("--plan-primary: #0F9D58;");
    expect(css).toContain("--plan-on-primary: #111111;");
    expect(css).toContain("--plan-secondary: #FFEB3B;");
    expect(css).toContain("--plan-on-secondary: #111111;");
    expect(css).toContain("--plan-primary-tint: color-mix(in srgb, #0F9D58 12%, var(--bg));");
  });

  it("contains only validated values (security test, spec 2b)", async () => {
    const { planId, newClient } = await setup();
    const css = await (await newClient().get(`/p/${planId}/theme.css`)).text();
    const declarations = [...css.matchAll(/(--[a-z-]+):\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThanOrEqual(6);
    for (const [, name, value] of declarations) {
      expect({ name, value: VALUE.test(value ?? "") }).toEqual({ name, value: true });
    }
    expect(
      css.replace(/(--[a-z-]+):\s*([^;]+);/g, "").replace(/\s|:root|\{|\}|\/\*[^*]*\*\//g, ""),
    ).toBe("");
  });

  it("is linked from the plan page for every audience, versioned by the colors", async () => {
    const { host, planId, newClient } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");
    for (const client of [host, ben, newClient()]) {
      expect(await (await client.get(`/p/${planId}`)).text()).toContain(
        `<link rel="stylesheet" href="/p/${planId}/theme.css?v=0F9D58-FFEB3B"/>`,
      );
    }
  });

  it("can be cached for long, since a color change changes the URL", async () => {
    const { planId, newClient } = await setup();
    expect(
      (await newClient().get(`/p/${planId}/theme.css?v=0F9D58-FFEB3B`)).headers.get(
        "cache-control",
      ),
    ).toBe("public, max-age=31536000, immutable");
  });

  it("leaves forms and other app pages neutral", async () => {
    const { host, planId } = await setup();
    for (const path of [`/p/${planId}/host`, "/new", "/"]) {
      expect(await (await host.get(path)).text()).not.toContain("theme.css");
    }
  });

  it("answers 404 for unknown plans (decision P4)", async () => {
    const test = await createTestApp();
    expect((await new TestClient(test.app).get("/p/AAAAAAAAAAAAAAAAAAAAAA/theme.css")).status).toBe(
      404,
    );
  });
});
