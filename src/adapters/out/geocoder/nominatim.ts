// Place search through Nominatim (spec 3.9): server-side only, via OutboundHttp (SSRF rules),
// at most one request per second, results cached in memory for at most 7 days (public data).
import { publicAreaFrom } from "../../../domain/geo.ts";
import { stripBidiControls } from "../../../domain/text.ts";
import { PLAN_LIMITS } from "../../../domain/plan-input.ts";
import type { Clock, Geocoder, OutboundHttp, Place } from "../../../application/ports.ts";

const RESULT_LIMIT = 5;
/** Nominatim's zoom for a neighbourhood: the finest level that still names no street. */
const REVERSE_ZOOM = 14;
/**
 * Address parts that name a district, then a settlement; never the road, house number or any named
 * building, and not `neighbourhood` (often one housing estate, more precise than the 1 km circle).
 */
const DISTRICT_KEYS = ["suburb", "city_district", "borough", "quarter"] as const;
const SETTLEMENT_KEYS = ["city", "town", "village", "municipality"] as const;

function firstPart(address: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = address[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

export function createNominatimGeocoder({
  http,
  baseUrl,
  throttle,
}: {
  http: OutboundHttp;
  baseUrl: URL;
  throttle: Throttle;
}): Geocoder {
  const root = baseUrl.href.endsWith("/") ? baseUrl : `${baseUrl.href}/`;
  const searchUrl = new URL("search", root);
  const reverseUrl = new URL("reverse", root);
  return {
    async search(query, { language }) {
      const url = new URL(searchUrl);
      url.search = new URLSearchParams({
        q: query,
        format: "jsonv2",
        limit: String(RESULT_LIMIT),
        "accept-language": language,
      }).toString();
      const response = await throttle(() =>
        http.get(url, { headers: { accept: "application/json" }, maxBytes: 256 * 1024 }),
      );
      if (response.status !== 200) throw new Error(`Geocoder answered ${response.status}.`);
      const data: unknown = JSON.parse(new TextDecoder().decode(response.body));
      if (!Array.isArray(data)) throw new Error("Unexpected geocoder response.");
      return data.slice(0, RESULT_LIMIT).map((entry: unknown): Place => {
        const { display_name: label, lat, lon } = (entry ?? {}) as Record<string, unknown>;
        const point = { lat: Number(lat), lng: Number(lon) };
        if (
          typeof label !== "string" ||
          !Number.isFinite(point.lat) ||
          !Number.isFinite(point.lng)
        ) {
          throw new Error("Unexpected geocoder result.");
        }
        return { label, ...point };
      });
    },
    async reverse(point, { language }) {
      const url = new URL(reverseUrl);
      url.search = new URLSearchParams({
        lat: String(point.lat),
        lon: String(point.lng),
        format: "jsonv2",
        zoom: String(REVERSE_ZOOM),
        addressdetails: "1",
        "accept-language": language,
      }).toString();
      const response = await throttle(() =>
        http.get(url, { headers: { accept: "application/json" }, maxBytes: 256 * 1024 }),
      );
      if (response.status !== 200) throw new Error(`Geocoder answered ${response.status}.`);
      const data: unknown = JSON.parse(new TextDecoder().decode(response.body));
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error("Unexpected geocoder response.");
      }
      const { error, address } = data as Record<string, unknown>;
      // Nominatim answers "nothing found here" with an error field instead of a place.
      if (error !== undefined || address === undefined) return undefined;
      if (typeof address !== "object" || address === null || Array.isArray(address)) {
        throw new Error("Unexpected geocoder result.");
      }
      const parts = address as Record<string, unknown>;
      const district = firstPart(parts, DISTRICT_KEYS);
      const settlement = firstPart(parts, SETTLEMENT_KEYS);
      const name = [district, settlement === district ? undefined : settlement].filter(
        (part) => part !== undefined,
      );
      if (name.length === 0) return undefined;
      // Upstream text: no control or bidi characters, one space at a time, cut on a code point and
      // never left ending in a separator.
      const clean = stripBidiControls(name.join(", "))
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
      if (clean === "") return undefined;
      const cut = Array.from(clean).slice(0, PLAN_LIMITS.areaLabel).join("");
      return cut.replace(/[\s,]+$/u, "") || undefined;
    },
  };
}

/** Runs work no more often than once per interval; callers that would wait too long are refused. */
export type Throttle = <T>(run: () => Promise<T>) => Promise<T>;

export function createThrottle({
  minIntervalMs,
  maxWaitMs,
}: {
  minIntervalMs: number;
  maxWaitMs: number;
}): Throttle {
  let nextSlot = 0;
  return async (run) => {
    const now = Date.now();
    const start = Math.max(now, nextSlot);
    const wait = start - now;
    if (wait > maxWaitMs) throw new Error("Geocoder busy.");
    nextSlot = start + minIntervalMs;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return run();
  };
}

/** In-memory cache with expiry and a size cap; failures are not cached. */
export function createCachedGeocoder(
  inner: Geocoder,
  { clock, ttlMs, maxEntries }: { clock: Clock; ttlMs: number; maxEntries: number },
): Geocoder {
  const entries = new Map<string, { expires: number; value: unknown }>();
  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = clock.now().getTime();
    const hit = entries.get(key);
    // Safe: the key prefixes "search\n" and "reverse\n" keep the two value types apart.
    if (hit !== undefined && hit.expires > now) return hit.value as T;
    entries.delete(key);
    const value = await load();
    entries.set(key, { expires: now + ttlMs, value });
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value ?? key);
    return value;
  }
  return {
    search: (query, options) =>
      cached(`search\n${options.language}\n${query.toLowerCase()}`, () =>
        inner.search(query, options),
      ),
    // By grid cell: the wrapped geocoder never sees more than the cell (decision D70). A found
    // name and a cell with no name are both kept for the same time (a cell's name hardly
    // changes, and an empty cell would otherwise cost a request per tap); failures are not.
    reverse: (point, options) => {
      const cell = publicAreaFrom(point);
      return cached(
        `reverse\n${options.language}\n${cell.lat.toFixed(2)},${cell.lng.toFixed(2)}`,
        () => inner.reverse(cell, options),
      );
    },
  };
}
