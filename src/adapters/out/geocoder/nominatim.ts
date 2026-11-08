// Place search through Nominatim (spec 3.9): server-side only, via OutboundHttp (SSRF rules),
// at most one request per second, results cached in memory for at most 7 days (public data).
import type { Clock, Geocoder, OutboundHttp, Place } from "../../../application/ports.ts";

const RESULT_LIMIT = 5;

export function createNominatimGeocoder({
  http,
  baseUrl,
  throttle,
}: {
  http: OutboundHttp;
  baseUrl: URL;
  throttle: Throttle;
}): Geocoder {
  const searchUrl = new URL("search", baseUrl.href.endsWith("/") ? baseUrl : `${baseUrl.href}/`);
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
  const entries = new Map<string, { expires: number; places: Place[] }>();
  return {
    async search(query, options) {
      const key = `${options.language}\n${query.toLowerCase()}`;
      const now = clock.now().getTime();
      const hit = entries.get(key);
      if (hit !== undefined && hit.expires > now) return hit.places;
      entries.delete(key);
      const places = await inner.search(query, options);
      entries.set(key, { expires: now + ttlMs, places });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value ?? key);
      return places;
    },
  };
}
