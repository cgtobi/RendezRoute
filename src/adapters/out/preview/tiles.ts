// Map tiles fetched server-side for preview images (spec 3.9): through OutboundHttp (SSRF rules,
// identifying User-Agent), cached in memory for at most 7 days (spec 3.10, public data).
import type { Clock, MapTiles, OutboundHttp } from "../../../application/ports.ts";
import type { GeoPoint } from "../../../domain/geo.ts";

const TILE_SIZE = 256;
const MAX_TILE_BYTES = 512 * 1024;

export function createMapTiles({
  http,
  tileUrl,
  clock,
  ttlMs,
  maxEntries,
}: {
  http: OutboundHttp;
  tileUrl: string;
  clock: Clock;
  ttlMs: number;
  maxEntries: number;
}): MapTiles {
  const cache = new Map<string, { expires: number; image: Uint8Array }>();
  const url = (z: number, x: number, y: number) =>
    new URL(
      tileUrl
        .replace("{s}", "abc"[(x + y) % 3] ?? "a")
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y)),
    );

  return {
    async tile(z, x, y) {
      const key = `${z}/${x}/${y}`;
      const now = clock.now().getTime();
      const hit = cache.get(key);
      if (hit !== undefined && hit.expires > now) return hit.image;
      cache.delete(key);
      try {
        const response = await http.get(url(z, x, y), { maxBytes: MAX_TILE_BYTES });
        const type = response.headers["content-type"] ?? "";
        if (response.status !== 200 || !/^image\/(png|jpeg)\b/.test(type)) return undefined;
        cache.set(key, { expires: now + ttlMs, image: response.body });
        if (cache.size > maxEntries) cache.delete(cache.keys().next().value ?? key);
        return response.body;
      } catch {
        return undefined;
      }
    },
  };
}

export interface TileWindow {
  zoom: number;
  /** Tiles covering the box, with their offset from its top-left corner in pixels. */
  tiles: { x: number; y: number; left: number; top: number }[];
  metersPerPixel: number;
}

/** The Web Mercator tiles covering a width × height box centred on the point. */
export function tileWindow(
  point: GeoPoint,
  zoom: number,
  width: number,
  height: number,
): TileWindow {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const lat = (point.lat * Math.PI) / 180;
  const centerX = ((point.lng + 180) / 360) * worldSize;
  const centerY = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * worldSize;
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  const count = 2 ** zoom;
  const tiles: TileWindow["tiles"] = [];
  for (
    let ty = Math.floor(top / TILE_SIZE);
    ty <= Math.floor((top + height - 1) / TILE_SIZE);
    ty++
  ) {
    if (ty < 0 || ty >= count) continue;
    for (
      let tx = Math.floor(left / TILE_SIZE);
      tx <= Math.floor((left + width - 1) / TILE_SIZE);
      tx++
    ) {
      tiles.push({
        x: ((tx % count) + count) % count,
        y: ty,
        left: Math.round(tx * TILE_SIZE - left),
        top: Math.round(ty * TILE_SIZE - top),
      });
    }
  }
  return { zoom, tiles, metersPerPixel: (156_543.033_92 * Math.cos(lat)) / count };
}
