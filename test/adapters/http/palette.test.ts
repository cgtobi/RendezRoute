// The instance palette in the pages and the static route (decision 004).
import { describe, expect, it } from "vite-plus/test";
import { assetUrl } from "../../../src/adapters/in/http/asset-url.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";

const TOKEN = "admin-token-for-tests-0123456789abcdef";

describe("the palette in the page head", () => {
  it("sets data-palette and links the versioned stylesheet after app.css for bold", async () => {
    const { app } = await createTestApp({ env: { PALETTE: "bold" } });
    const html = await (await new TestClient(app).get("/")).text();
    expect(html).toMatch(/<html [^>]*data-palette="bold"/);
    const link = `<link rel="stylesheet" href="${assetUrl("/", "palettes/bold.css")}"`;
    expect(assetUrl("/", "palettes/bold.css")).toMatch(/^\/static\/palettes\/bold\.css\?v=/);
    expect(html).toContain(link);
    expect(html.indexOf(link)).toBeGreaterThan(html.indexOf('href="/static/app.css?v='));
    expect(html).not.toContain("palettes/mono.css");
  });

  it("uses the mono stylesheet for mono", async () => {
    const { app } = await createTestApp({ env: { PALETTE: "mono" } });
    const html = await (await new TestClient(app).get("/")).text();
    expect(html).toContain('data-palette="mono"');
    expect(html).toContain("/static/palettes/mono.css?v=");
    expect(html).not.toContain("palettes/bold.css");
  });

  it("links the Archivo Narrow font files before the palette sheet, for archivo only", async () => {
    const fontsLink = `href="${assetUrl("/", "build/archivo-fonts.css")}"`;
    for (const palette of ["default", "mono", "bold"]) {
      const { app } = await createTestApp({ env: { PALETTE: palette } });
      const html = await (await new TestClient(app).get("/")).text();
      expect(html).not.toContain("archivo-fonts.css");
    }
    const { app } = await createTestApp({ env: { PALETTE: "archivo" } });
    const html = await (await new TestClient(app).get("/")).text();
    expect(html).toContain('data-palette="archivo"');
    expect(html).toContain(fontsLink);
    expect(html.indexOf(fontsLink)).toBeLessThan(html.indexOf("palettes/archivo.css"));
    expect(html.indexOf(fontsLink)).toBeGreaterThan(html.indexOf('href="/static/app.css?v='));
  });

  it("adds no attribute and no link for the default palette", async () => {
    for (const env of [{}, { PALETTE: "default" }]) {
      const { app } = await createTestApp({ env });
      const html = await (await new TestClient(app).get("/")).text();
      expect(html).not.toContain("data-palette");
      expect(html).not.toContain("palettes/");
    }
  });

  it("keeps the admin listener on the default colours", async () => {
    const { adminApp } = await createTestApp({
      env: { PALETTE: "bold", ADMIN_TOKEN: TOKEN, ADMIN_PORT: "3001" },
    });
    if (adminApp === undefined) throw new Error("no admin app");
    const html = await (await new TestClient(adminApp).get("/admin/login")).text();
    expect(html).not.toContain("data-palette");
    expect(html).not.toContain("palettes/");
  });
});

describe("the palette stylesheets over /static", () => {
  it.each(["mono", "bold", "archivo"])(
    "serves %s with the immutable header for its version",
    async (id) => {
      const { app } = await createTestApp({ env: { PALETTE: id } });
      const client = new TestClient(app);
      const url = assetUrl("/", `palettes/${id}.css`);
      const response = await client.get(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/css");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(await response.text()).toContain(`:root[data-palette="${id}"]`);
      const unversioned = await client.get(`/static/palettes/${id}.css`);
      expect(unversioned.headers.get("cache-control")).toBe("public, max-age=3600");
    },
  );
});
