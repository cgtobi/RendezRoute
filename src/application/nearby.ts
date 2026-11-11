// Nearby (spec 7 Visibility and Nearby plans; decisions D35, I59): public plans near a point on
// the viewer's grid, from the map or the device (rounded by the browser and again by the domain)
// or from a typed place (looked up with the geocoder, then put on the grid).
// The place is used only for this query, on the domain's coarse grid; nothing of it is stored or
// returned. Each plan comes with its public fields only (spec 3.6, Viewer).
import type { ActivityType } from "../domain/activity.ts";
import { distanceMeters, type GeoPoint } from "../domain/geo.ts";
import {
  boundingBox,
  matchesNearby,
  type NearbyFieldError,
  type NearbyInput,
  onGrid,
  validateNearbyFilters,
} from "../domain/nearby.ts";
import type { Plan } from "../domain/plan.ts";
import type { PaceBand, Units } from "../domain/pace.ts";
import { searchPlaces } from "./places.ts";
import type { PlanDeps } from "./plans.ts";
import type { Geocoder } from "./ports.ts";

/** Listed at most, by start. */
const MAX_RESULTS = 50;
/** Candidates are read a page at a time until enough match; the work stays bounded. */
const PAGE = 200;
const MAX_PAGES = 25;

/** What a viewer sees of a public plan in the list (spec 3.6, Viewer). */
export interface NearbyItem {
  planId: string;
  title: string;
  activity: ActivityType;
  startsAt: Date;
  timeZone: string;
  areaLabel: string;
  distanceMeters: number | undefined;
  elevationGainMeters: number | undefined;
  pace: PaceBand | undefined;
  /** From the viewer's grid point to the plan's public point, in whole km. */
  awayKm: number;
}

export type NearbySearch =
  | { kind: "invalid"; errors: NearbyFieldError[] }
  /** `truncated`: more matched than are listed. */
  | { kind: "results"; items: NearbyItem[]; truncated: boolean };

export type NearbyPlace =
  | { kind: "point"; point: GeoPoint }
  | { kind: "invalid"; errors: NearbyFieldError[] }
  | { kind: "place_not_found" }
  /** No geocoder, or it did not answer. */
  | { kind: "place_unavailable" };

/**
 * A typed place, looked up with the geocoder: its first result on the viewer's grid (decision
 * D35). The caller sends the viewer on to the rounded point, so the results page, the browser
 * history and the return address hold only that.
 */
export async function locateNearbyPlace(
  geocoder: Geocoder | undefined,
  request: { place: string; language: string },
): Promise<NearbyPlace> {
  if (geocoder === undefined) return { kind: "place_unavailable" };
  const found = await searchPlaces(
    { geocoder },
    { query: request.place, language: request.language },
  );
  if (found.kind === "unavailable") return { kind: "place_unavailable" };
  if (found.kind === "invalid") {
    return { kind: "invalid", errors: [{ field: "place", code: "place_invalid" }] };
  }
  const [first] = found.places;
  return first === undefined
    ? { kind: "place_not_found" }
    : { kind: "point", point: onGrid(first) };
}

/** Public plans around a point already on the viewer's grid, matching the filters. */
export async function findNearby(
  deps: Pick<PlanDeps, "plans" | "clock" | "limits">,
  request: { center: GeoPoint; input: NearbyInput; units: Units; timeZone: string },
): Promise<NearbySearch> {
  const now = deps.clock.now();
  const filters = validateNearbyFilters(request.input, {
    now,
    horizonDays: deps.limits.horizonDays,
    timeZone: request.timeZone,
    units: request.units,
  });
  if (!filters.ok) return { kind: "invalid", errors: filters.errors };
  const { center } = request;
  const box = boundingBox(center, filters.value.radiusKm * 1000);
  // Upcoming only: never a plan that started already.
  const window = {
    from: new Date(Math.max(filters.value.from.getTime(), now.getTime())),
    to: filters.value.to,
  };
  const matched: Plan[] = [];
  for (let page = 0; page < MAX_PAGES && matched.length <= MAX_RESULTS; page++) {
    const candidates = await deps.plans.findPublicIn(box, window, {
      activity: filters.value.activity,
      limit: PAGE,
      offset: page * PAGE,
    });
    matched.push(...candidates.filter((plan) => matchesNearby(plan, center, filters.value, now)));
    if (candidates.length < PAGE) break;
  }
  const items = matched.slice(0, MAX_RESULTS).map((plan): NearbyItem => ({
    planId: plan.id,
    title: plan.title,
    activity: plan.activity,
    startsAt: plan.startsAt,
    timeZone: plan.timeZone,
    areaLabel: plan.area.label,
    distanceMeters: plan.distanceMeters,
    elevationGainMeters: plan.elevationGainMeters,
    pace: plan.pace,
    awayKm: Math.round(distanceMeters(center, plan.area.point ?? center) / 1000),
  }));
  return { kind: "results", items, truncated: matched.length > MAX_RESULTS };
}
