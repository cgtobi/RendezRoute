import { describe, expect, it } from "vite-plus/test";
import { createMapTiles, tileWindow } from "../../../../src/adapters/out/preview/tiles.ts";
import { FakeClock } from "../../../fakes/clock.ts";
import { FakeOutboundHttp } from "../../../fakes/outbound-http.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const DAY = 24 * 60 * 60 * 1000;

function setup(template = "https://tile.example.org/{z}/{x}/{y}.png") {
  const http = new FakeOutboundHttp().respond("https://", {
    headers: { "content-type": "image/png" },
    body: PNG,
  });
  const clock = new FakeClock();
  const tiles = createMapTiles({ http, tileUrl: template, clock, ttlMs: 7 * DAY, maxEntries: 2 });
  return { http, clock, tiles };
}

describe("map tiles for preview images (spec 3.9: fetched server-side and cached)", () => {
  it("fills the URL template, including a stable {s} subdomain", async () => {
    const { http, tiles } = setup("https://{s}.tile.example.org/{z}/{x}/{y}.png");
    expect(await tiles.tile(14, 8717, 5683)).toEqual(PNG);
    expect(http.requests.map(String)).toEqual([
      expect.stringMatching(/^https:\/\/[abc]\.tile\.example\.org\/14\/8717\/5683\.png$/),
    ]);
  });

  it("answers repeated requests from the cache for at most 7 days (spec 3.10)", async () => {
    const { http, clock, tiles } = setup();
    await tiles.tile(14, 1, 2);
    await tiles.tile(14, 1, 2);
    expect(http.requests).toHaveLength(1);
    clock.advance({ days: 7 });
    await tiles.tile(14, 1, 2);
    expect(http.requests).toHaveLength(2);
  });

  it("keeps the cache small by dropping the oldest tiles", async () => {
    const { http, tiles } = setup();
    for (const x of [1, 2, 3, 1]) await tiles.tile(14, x, 0);
    expect(http.requests).toHaveLength(4);
  });

  it("returns nothing for failures and non-images, without caching them", async () => {
    const http = new FakeOutboundHttp()
      .respond("https://tile.example.org/14/1/", { status: 404, body: PNG })
      .respond("https://tile.example.org/14/2/", { headers: { "content-type": "text/html" } })
      .fail("https://tile.example.org/14/3/", new Error("timeout"));
    const tiles = createMapTiles({
      http,
      tileUrl: "https://tile.example.org/{z}/{x}/{y}.png",
      clock: new FakeClock(),
      ttlMs: DAY,
      maxEntries: 10,
    });
    for (const x of [1, 2, 3]) expect(await tiles.tile(14, x, 0)).toBeUndefined();
    await tiles.tile(14, 1, 0);
    expect(http.requests).toHaveLength(4);
  });
});

describe("tileWindow", () => {
  it("covers a box centred on the point with the tiles it needs", () => {
    const window = tileWindow({ lat: 48.1107, lng: 11.5582 }, 14, 520, 630);
    // The point lies in tile (8718, 5687) at zoom 14.
    expect(window.tiles).toContainEqual(expect.objectContaining({ x: 8718, y: 5687 }));
    for (const tile of window.tiles) {
      expect(tile.left).toBeGreaterThan(-256);
      expect(tile.left).toBeLessThan(520);
      expect(tile.top).toBeGreaterThan(-256);
      expect(tile.top).toBeLessThan(630);
    }
    expect(window.tiles).toHaveLength(3 * 4);
    // About 750 m at 48° N and zoom 14 (6.38 m per pixel).
    expect(window.metersPerPixel).toBeCloseTo(6.38, 1);
  });
});
