// Place search endpoint (spec 3.9, decision D12): same-origin JSON behind the CSRF middleware,
// so it cannot serve as an open geocoding proxy.
import type { Hono } from "hono";
import {
  describeExactPoint,
  searchPlaces,
  suggestPlaceName,
} from "../../../../application/places.ts";
import type { Geocoder } from "../../../../application/ports.ts";
import type { AppEnv } from "../app.tsx";
import type { RateLimits } from "../rate-limit.ts";
import { clientOf } from "./shared.tsx";

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

  // Label suggestion for a point picked on the form map (decision D70). The application snaps
  // the point to the public grid before the geocoder (and its cache) sees it.
  app.post("/geocode/reverse", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const point =
      typeof body === "object" && body !== null && "lat" in body && "lng" in body
        ? { lat: body.lat, lng: body.lng }
        : undefined;
    c.header("cache-control", "no-store");
    if (point === undefined || typeof point.lat !== "number" || typeof point.lng !== "number") {
      return c.json({ error: "bad_request" }, 400);
    }
    const allowed = limits.geocode.take(clientOf(c));
    if (!allowed.ok) {
      c.header("retry-after", String(allowed.retryAfterSeconds));
      return c.json({ error: "rate_limited" }, 429);
    }
    const result = await suggestPlaceName(
      { geocoder },
      { lat: point.lat, lng: point.lng, language: c.get("language") },
    );
    switch (result.kind) {
      case "found":
        return c.json({ label: result.label });
      case "none":
        return c.json({ label: null });
      case "invalid":
        return c.json({ error: "bad_request" }, 400);
      case "unavailable":
        return c.json({ error: "unavailable" }, 503);
    }
  });

  // Description suggestion for the exact point set on the form map (decision D77). The only route
  // that sends an exact point to the geocoder: it is not snapped, not cached and not logged.
  app.post("/geocode/describe", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    // Exactly lat and lng: this route sends the point on unsnapped, so nothing else is accepted.
    const point =
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      Object.keys(body).toSorted().join() === "lat,lng" &&
      "lat" in body &&
      "lng" in body
        ? { lat: body.lat, lng: body.lng }
        : undefined;
    c.header("cache-control", "no-store");
    if (point === undefined || typeof point.lat !== "number" || typeof point.lng !== "number") {
      return c.json({ error: "bad_request" }, 400);
    }
    const allowed = limits.geocode.take(clientOf(c));
    if (!allowed.ok) {
      c.header("retry-after", String(allowed.retryAfterSeconds));
      return c.json({ error: "rate_limited" }, 429);
    }
    const result = await describeExactPoint(
      { geocoder },
      { lat: point.lat, lng: point.lng, language: c.get("language") },
    );
    switch (result.kind) {
      case "found":
        return c.json({ label: result.label });
      case "none":
        return c.json({ label: null });
      case "invalid":
        return c.json({ error: "bad_request" }, 400);
      case "unavailable":
        return c.json({ error: "unavailable" }, 503);
    }
  });
}
