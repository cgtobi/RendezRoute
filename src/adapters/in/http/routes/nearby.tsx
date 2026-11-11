// Nearby (spec 7 Visibility and Nearby plans; decisions D35, I59): GET /nearby, only while
// NEARBY_ENABLED. The viewer's place is in the query string, already rounded by the browser and
// rounded again by the domain; a typed place is looked up and the viewer sent on to its rounded
// point, so the results page holds only that. Nothing of it is stored or logged (the request log
// has the route only), and the page is neither cached nor sent on as a referrer. Searches are
// rate limited, typed places also by the place search limit (spec 3.9).
import type { Hono } from "hono";
import {
  findNearby,
  locateNearbyPlace,
  type NearbyPlace,
  type NearbySearch,
} from "../../../../application/nearby.ts";
import {
  NEARBY_FIELDS,
  type NearbyField,
  type NearbyInput,
  nearbyDays,
  nearbyInput,
  viewerPoint,
} from "../../../../domain/nearby.ts";
import { loginConfigured } from "../../../../config.ts";
import type { AppEnv } from "../app.tsx";
import { MapAssets } from "../views/maps.tsx";
import { NearbyPage } from "../views/nearby.tsx";
import { clientOf, mapSettings, type RouteDeps, tooManyRequests } from "./shared.tsx";

/** Typed in the viewer's units: a units switch would change their meaning, so it drops them. */
const UNIT_FIELDS: readonly NearbyField[] = ["distanceFrom", "distanceTo", "paceFrom", "paceTo"];

/** The page's address for these values, with only the fields that are set. */
function nearbyPath(values: NearbyInput, omit: readonly NearbyField[] = []): string {
  const query = new URLSearchParams(
    NEARBY_FIELDS.filter((field) => values[field] !== "" && !omit.includes(field)).map((field) => [
      field,
      values[field],
    ]),
  ).toString();
  return query === "" ? "/nearby" : `/nearby?${query}`;
}

export function registerNearbyRoutes(app: Hono<AppEnv>, deps: RouteDeps) {
  const { config, planDeps, geocoder, limits } = deps;
  // With login required and none offered, no plan can be public: there is nothing to search.
  const nothingPublic = config.publicRequiresLogin && !loginConfigured(config);

  app.get("/nearby", async (c) => {
    c.header("cache-control", "no-store");
    c.header("referrer-policy", "no-referrer");
    c.header("x-robots-tag", "noindex");
    const t = c.get("t");
    const input = nearbyInput((field) => (c.req.query(field) ?? "").trim());
    const point = viewerPoint(input);
    // Only a valid point goes back into the form, never more precise than the grid.
    const kept: NearbyInput = {
      ...input,
      place: "",
      lat: typeof point === "object" ? String(point.lat) : "",
      lng: typeof point === "object" ? String(point.lng) : "",
    };

    let result: NearbySearch | Exclude<NearbyPlace, { kind: "point" }> | undefined;
    if (nothingPublic) result = undefined;
    else if (input.place !== "") {
      // Each typed place may cost a call to the shared geocoder, as place search does.
      const allowed = limits.geocode.take(clientOf(c));
      if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
      const located = await locateNearbyPlace(geocoder, {
        place: input.place,
        language: c.get("language"),
      });
      if (located.kind === "point") {
        const at = { lat: String(located.point.lat), lng: String(located.point.lng) };
        return c.redirect(nearbyPath({ ...kept, ...at }), 303);
      }
      result = located;
    } else if (point === "invalid") {
      result = { kind: "invalid", errors: [{ field: "lat", code: "coordinates_invalid" }] };
    } else if (point !== undefined) {
      const allowed = limits.nearby.take(clientOf(c));
      if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
      result = await findNearby(planDeps, {
        center: point,
        input,
        units: c.get("units"),
        timeZone: config.defaultTimezone,
      });
    }

    const days = nearbyDays({
      now: planDeps.clock.now(),
      horizonDays: planDeps.limits.horizonDays,
      timeZone: config.defaultTimezone,
    });
    return c.render(
      <NearbyPage
        t={t}
        language={c.get("language")}
        units={c.get("units")}
        values={{
          ...kept,
          place: input.place,
          from: kept.from || days.from,
          to: kept.to || days.to,
        }}
        defaultDays={days}
        result={result}
        map={mapSettings(config)}
        placeSearch={geocoder === undefined ? undefined : { csrfToken: c.get("csrfToken")() }}
        nothingPublic={nothingPublic}
      />,
      {
        title: t("nearby.title"),
        head: <MapAssets />,
        returnTo: nearbyPath(kept, UNIT_FIELDS),
      },
    );
  });
}
