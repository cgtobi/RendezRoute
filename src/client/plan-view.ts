// Where the plan's full-screen map looks, and what its key lists (ADR 008). DOM-free and without
// Leaflet, so the rules are tested in Node; plan-map.ts turns a view into Leaflet calls.
import { AREA_RADIUS_M, distanceMeters, type Point, zoomForAccuracy } from "./geo.ts";

/** A map view: a centre with a zoom, or a box to fit. */
export type MapView =
  | { kind: "point"; center: Point; zoom: number }
  | { kind: "bounds"; southWest: Point; northEast: Point };

/** The plan map's zoom on the public area alone, as on the page. */
export const PLAN_ZOOM = 14;

/** "Show where I am" keeps the plan's point in view up to this distance (lead decision 6). */
export const NEAR_METRES = 20_000;

const METRES_PER_DEGREE = 111_320;

/** The smallest box holding every point. */
function boundsOf(points: readonly [Point, ...Point[]]): MapView {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  return {
    kind: "bounds",
    southWest: { lat: Math.min(...lats), lng: Math.min(...lngs) },
    northEast: { lat: Math.max(...lats), lng: Math.max(...lngs) },
  };
}

/**
 * The full-screen plan map's first view, before a route is drawn: the area circle and the exact
 * start together when the page has the exact start, else the area at the page map's zoom.
 */
export function planFocus(area: Point, exact: Point | undefined): MapView {
  if (exact === undefined) return { kind: "point", center: area, zoom: PLAN_ZOOM };
  const dLat = AREA_RADIUS_M / METRES_PER_DEGREE;
  // Kept finite near the poles, where a degree of longitude shrinks to nothing.
  const cos = Math.max(Math.cos((area.lat * Math.PI) / 180), 0.01);
  const dLng = AREA_RADIUS_M / (METRES_PER_DEGREE * cos);
  return boundsOf([
    { lat: area.lat - dLat, lng: area.lng - dLng },
    { lat: area.lat + dLat, lng: area.lng + dLng },
    exact,
  ]);
}

/**
 * The view after "Show where I am": the position together with the plan's point (the exact start
 * if the page has it, else the area) when they are within 20 km, else the position alone at the
 * zoom its accuracy allows.
 */
export function locateView(me: Point, accuracyMeters: number, planPoint: Point): MapView {
  return distanceMeters(me, planPoint) <= NEAR_METRES
    ? boundsOf([me, planPoint])
    : { kind: "point", center: me, zoom: zoomForAccuracy(accuracyMeters) };
}

export type LegendEntry = "area" | "exact" | "route";

/**
 * The key's entries: always the public area; the exact start and the route only when the page map
 * has them (the server sent them, spec 3.6). The route entry goes once its file failed to load
 * (`routeLoaded: false`); while it loads (undefined) it stays.
 */
export function legendEntries(input: {
  hasExact: boolean;
  hasRoute: boolean;
  routeLoaded?: boolean | undefined;
}): LegendEntry[] {
  const entries: LegendEntry[] = ["area"];
  if (input.hasExact) entries.push("exact");
  if (input.hasRoute && input.routeLoaded !== false) entries.push("route");
  return entries;
}
