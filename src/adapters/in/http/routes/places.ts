// Place search endpoint (spec 3.9, decision D12): same-origin JSON behind the CSRF middleware,
// so it cannot serve as an open geocoding proxy.
import type { Hono } from "hono";
import { searchPlaces } from "../../../../application/places.ts";
import type { Geocoder } from "../../../../application/ports.ts";
import type { AppEnv } from "../app.tsx";

export function registerPlaceRoutes(app: Hono<AppEnv>, { geocoder }: { geocoder: Geocoder }) {
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
