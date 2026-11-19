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
    // The primary made readable on bold's #FEFEFE and #0A0A0A (domain planInk); #0F9D58 is 3.5:1
    // on white, so the light ink is darker and the dark ink is the colour itself.
    expect(css).toMatch(/--plan-ink-on-light: #[0-9A-F]{6};/);
    expect(css).toContain("--plan-ink-on-dark: #0F9D58;");
    expect(css).toContain("--plan-primary-tint: color-mix(in srgb, #0F9D58 12%, var(--bg));");
  });

  it("contains only validated values (security test, spec 2b)", async () => {
    const { planId, newClient } = await setup();
    const css = await (await newClient().get(`/p/${planId}/theme.css`)).text();
    const declarations = [...css.matchAll(/(--[a-z-]+):\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThanOrEqual(8);
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
        `<link rel="stylesheet" href="/p/${planId}/theme.css?v=0F9D58-FFEB3B-2"/>`,
      );
    }
  });

  it("can be cached for long, since a color change changes the URL", async () => {
    const { planId, newClient } = await setup();
    expect(
      (await newClient().get(`/p/${planId}/theme.css?v=0F9D58-FFEB3B-2`)).headers.get(
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

  // Bold only: the host page takes the plan's colour for its links and controls (decision 007).
  describe("on the host page", () => {
    async function hostPage(env: Record<string, string> = {}) {
      const test = await createTestApp({ env });
      const host = new TestClient(test.app);
      const { planId, hostPath } = await createPlanViaUi(host, {
        primaryColor: "#0f9d58",
        secondaryColor: "#FFEB3B",
      });
      await host.get(hostPath);
      return { planId, page: await (await host.get(`/p/${planId}/host`)).text() };
    }

    it("links the plan's versioned theme.css when the palette is bold", async () => {
      const { planId, page } = await hostPage({ PALETTE: "bold" });
      expect(page).toContain(
        `<link rel="stylesheet" href="/p/${planId}/theme.css?v=0F9D58-FFEB3B-2"/>`,
      );
    });

    it("links nothing for the default palette or another one, which stay as they were", async () => {
      for (const env of [{}, { PALETTE: "default" }, { PALETTE: "mono" }]) {
        const { page } = await hostPage(env);
        expect(page).not.toContain("theme.css");
      }
    });

    it("follows the visitor's own palette over the instance's", async () => {
      const test = await createTestApp({ env: { PALETTE: "mono" } });
      const host = new TestClient(test.app);
      const { planId, hostPath } = await createPlanViaUi(host, {});
      await host.get(hostPath);
      const hidden = await host.hiddenFields("/new");
      await host.postForm("/palette", { ...hidden, palette: "bold", returnTo: "/new" });
      expect(await (await host.get(`/p/${planId}/host`)).text()).toContain(
        `/p/${planId}/theme.css?v=`,
      );
    });

    it("drops the link when the visitor leaves the instance's bold for another palette", async () => {
      const test = await createTestApp({ env: { PALETTE: "bold" } });
      const host = new TestClient(test.app);
      const { planId, hostPath } = await createPlanViaUi(host, {});
      await host.get(hostPath);
      const hidden = await host.hiddenFields("/new");
      await host.postForm("/palette", { ...hidden, palette: "mono", returnTo: "/new" });
      expect(await (await host.get(`/p/${planId}/host`)).text()).not.toContain("theme.css");
    });
  });
});
