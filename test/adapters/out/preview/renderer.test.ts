import { describe, expect, it } from "vite-plus/test";
import type { PlanPreview } from "../../../../src/application/plan-views.ts";
import type { MapTiles } from "../../../../src/application/ports.ts";
import { createPreviewRenderer } from "../../../../src/adapters/out/preview/renderer.ts";
import { previewOf } from "../../../../src/application/plan-views.ts";
import { samplePlan } from "../../../fixtures/plans.ts";

/** A valid 1 × 1 PNG, standing in for a 256 × 256 map tile. */
const TILE = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

class FakeTiles implements MapTiles {
  readonly requested: string[] = [];
  constructor(private readonly failing = false) {}
  tile(z: number, x: number, y: number) {
    this.requested.push(`${z}/${x}/${y}`);
    return Promise.resolve(this.failing ? undefined : TILE);
  }
}

const preview: PlanPreview = previewOf(samplePlan());

function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return {
    signature: Buffer.from(png.subarray(0, 8)).toString("hex"),
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

const renderer = (options: { tiles?: MapTiles | undefined; maxQueue?: number } = {}) =>
  createPreviewRenderer({
    instanceName: "Isar Runners",
    attribution: "© OpenStreetMap contributors",
    tiles: options.tiles,
    maxConcurrent: 1,
    maxQueue: options.maxQueue ?? 4,
  });

describe("preview card renderer (spec 3.3: Satori + resvg)", () => {
  it("renders a 1200 × 630 PNG without a map", { timeout: 20_000 }, async () => {
    const result = await renderer().render(preview);
    if (!result.ok) throw new Error(result.error);
    expect(pngSize(result.value)).toEqual({
      signature: "89504e470d0a1a0a",
      width: 1200,
      height: 630,
    });
  });

  it(
    "draws the area map from tiles around the public point only",
    { timeout: 20_000 },
    async () => {
      const tiles = new FakeTiles();
      const result = await renderer({ tiles }).render(preview);
      expect(result.ok).toBe(true);
      expect(tiles.requested.length).toBeGreaterThan(0);
      // Public point 48.16, 11.6 at zoom 14 lies in tile 8719/5684.
      expect(tiles.requested).toContain("14/8719/5684");
    },
  );

  it("leaves the map out when tiles are missing", { timeout: 20_000 }, async () => {
    const result = await renderer({ tiles: new FakeTiles(true) }).render(preview);
    expect(result.ok).toBe(true);
  });

  it("refuses work beyond its queue instead of piling up", { timeout: 20_000 }, async () => {
    const busy = renderer({ maxQueue: 0 });
    const [first, second] = await Promise.all([busy.render(preview), busy.render(preview)]);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "busy" });
  });
});
