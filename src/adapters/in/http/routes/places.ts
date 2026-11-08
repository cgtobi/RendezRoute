// Place search endpoint (spec 3.9, decision D12): same-origin JSON behind the CSRF middleware,
// so it cannot serve as an open geocoding proxy.
import type { Hono } from "hono";
import { searchPlaces } from "../../../../application/places.ts";
import type { Geocoder } from "../../../../application/ports.ts";
import type { AppEnv } from "../app.tsx";
import { clientOf, type RateLimits } from "./shared.tsx";

export function registerPlaceRoutes(
  app: Hono<AppEnv>,
  { geocoder, limits }: { geocoder: Geocoder; limits: RateLimits },
) {
  app.post("/geocode", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const query =
      typeof body === "object" && body !== null && "q" in body && typeof body.q === "string"
        ? body.q
        : undefined;
    c.header("cache-control", "no-store");
    if (query === undefined) return c.json({ error: "bad_request" }, 400);
    // Every search may cost a call to the shared geocoder (global 1 request/s, decision I29).
    const allowed = limits.geocode.take(clientOf(c));
    if (!allowed.ok) {
      c.header("retry-after", String(allowed.retryAfterSeconds));
      return c.json({ error: "rate_limited" }, 429);
    }
    const result = await searchPlaces({ geocoder }, { query, language: c.get("language") });
    switch (result.kind) {
      case "results":
        return c.json({ places: result.places });
      case "invalid":
        return c.json({ error: "bad_request" }, 400);
      case "unavailable":
        return c.json({ error: "unavailable" }, 503);
    }
  });
}
