// MapAssets under a path prefix (spec 3.8 URLs). Map assets are public-site only: every call site
// passes pathBase "/" on public routes. If an admin page ever gets a map, pathBase must come from
// adminRoot (Home Assistant Ingress serves the admin under a prefix) and the absolute geocode and
// route URLs must become prefix-aware as well.
import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
import { MapAssets } from "../../../src/adapters/in/http/views/maps.tsx";

async function render(pathBase: string): Promise<string> {
  const app = new Hono().get("/", (c) => c.html(<MapAssets pathBase={pathBase} />));
  return (await app.request("/")).text();
}

function urls(html: string) {
  return [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map(([, url = ""]) => url);
}

describe("MapAssets and path prefixes", () => {
  it("starts every URL with the given relative pathBase, never with a slash", async () => {
    const found = urls(await render("../"));
    expect(found).toHaveLength(2);
    for (const url of found) {
      expect(url.startsWith("../static/build/map.")).toBe(true);
      expect(url.startsWith("/")).toBe(false);
    }
    expect(found[0]).toMatch(/^\.\.\/static\/build\/map\.css(\?v=[0-9a-f]{10})?$/);
    expect(found[1]).toMatch(/^\.\.\/static\/build\/map\.js(\?v=[0-9a-f]{10})?$/);
  });

  it("starts every URL with the root pathBase", async () => {
    const found = urls(await render("/"));
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^\/static\/build\/map\.css(\?v=[0-9a-f]{10})?$/);
    expect(found[1]).toMatch(/^\/static\/build\/map\.js(\?v=[0-9a-f]{10})?$/);
  });

  it("carries the version query exactly as assetUrl produces it", async () => {
    const { assetUrl } = await import("../../../src/adapters/in/http/asset-url.ts");
    const html = await render("../");
    expect(urls(html)).toEqual([assetUrl("../", "build/map.css"), assetUrl("../", "build/map.js")]);
  });
});
