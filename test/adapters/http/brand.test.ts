// The logo and icons (decision D28): a tab icon, a home-screen icon and the mark in the header,
// served from the app itself and kept small.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";

const PUBLIC = join(import.meta.dirname, "../../../public");
const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";
const ICON_LINKS = [
  '<link rel="icon" href="BASEstatic/brand/tab-icon-32.png" sizes="32x32" type="image/png"/>',
  '<link rel="icon" href="BASEstatic/brand/tab-icon.svg" type="image/svg+xml"/>',
  '<link rel="apple-touch-icon" href="BASEstatic/brand/apple-touch-icon.png"/>',
];

/** Width, height and the first pixel's opacity (0–255) of a non-interlaced 8-bit RGBA PNG. */
function png(bytes: Buffer) {
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const [depth, colourType] = [bytes[24], bytes[25]];
  expect({ depth, colourType }).toEqual({ depth: 8, colourType: 6 });
  const data: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString("latin1", at + 4, at + 8) === "IDAT")
      data.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  // Row 0 after its filter byte: no row above and no pixel to the left, so every filter leaves the
  // first pixel as stored.
  const firstAlpha = inflateSync(Buffer.concat(data))[4];
  return { width, height, firstAlpha };
}

describe("logo and icons (decision D28)", () => {
  it("links the tab icon and the home-screen icon from every page, under the page's path base", async () => {
    const { app } = await createTestApp({ env: { ADMIN_TOKEN } });
    const home = await (await new TestClient(app).get("/")).text();
    const admin = await (await new TestClient(app).get("/admin/login")).text();
    for (const link of ICON_LINKS) {
      expect(home).toContain(link.replace("BASE", "/"));
      expect(admin).toContain(link.replace("BASE", "../"));
    }
    expect(home).not.toContain('href="data:,"');
  });

  it("serves each icon it links, with its image type", async () => {
    const { app } = await createTestApp();
    const client = new TestClient(app);
    const home = await (await client.get("/")).text();
    const hrefs = [...home.matchAll(/<link rel="(?:apple-touch-)?icon" href="([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(hrefs).toHaveLength(ICON_LINKS.length);
    for (const href of hrefs) {
      const response = await client.get(href);
      expect({
        href,
        status: response.status,
        type: response.headers.get("content-type")?.split(";")[0],
      }).toEqual({
        href,
        status: 200,
        type: href.endsWith(".svg") ? "image/svg+xml" : "image/png",
      });
    }
  });

  it("gives iOS a full, opaque square at 180 pixels, which it rounds itself", () => {
    const icon = png(readFileSync(join(PUBLIC, "brand/apple-touch-icon.png")));
    expect(icon).toEqual({ width: 180, height: 180, firstAlpha: 255 });
    expect(png(readFileSync(join(PUBLIC, "brand/tab-icon-32.png")))).toMatchObject({
      width: 32,
      height: 32,
    });
  });

  it("draws the tab icon dark on light tabs and light on dark ones", () => {
    const svg = readFileSync(join(PUBLIC, "brand/tab-icon.svg"), "utf8");
    expect(svg).toMatch(
      /path\{fill:#16335e\}@media \(prefers-color-scheme:dark\)\{path\{fill:#fff\}\}/,
    );
  });

  it("keeps the logo files small, without embedded pictures or editor data", () => {
    const files = [
      ...readdirSync(join(PUBLIC, "brand")).map((name) => `brand/${name}`),
      "icons/logo.svg",
    ];
    const found = files.map((file) => {
      const path = join(PUBLIC, file);
      const text = file.endsWith(".svg") ? readFileSync(path, "utf8") : "";
      return {
        file,
        small: statSync(path).size <= 10 * 1024,
        clean: !/<image|inkscape:|sodipodi:|data:/.test(text),
      };
    });
    expect(found).toEqual(files.map((file) => ({ file, small: true, clean: true })));
  });

  it("puts the logo before the site's name in the header, hidden from screen readers", async () => {
    const { app } = await createTestApp({ env: { INSTANCE_NAME: "Lauftreff Süd" } });
    const html = await (await new TestClient(app).get("/")).text();
    expect(html).toContain(
      '<header class="site-header"><a href="/"><span class="logo" aria-hidden="true"></span>Lauftreff Süd</a></header>',
    );
  });
});
