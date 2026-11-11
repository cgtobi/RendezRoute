// Nearby (spec 7 Visibility and Nearby plans, decisions D35, I59): public plans near a place the
// viewer chooses, filtered by dates, activity, distance and pace. The viewer's place is used only
// for the query, on a 0.02° grid (about 2 km), coarser than the public plan points: the browser
// rounds it before it enters the URL, and it is rounded again here, whatever was sent.
import { ACTIVITY_TYPES, type ActivityType, paceStyleFor } from "./activity.ts";
import { distanceMeters, type GeoPoint, snapToGrid, validateGeoPoint } from "./geo.ts";
import { type PaceBand, paceFromSpeed, parsePace } from "./pace.ts";
import type { Plan } from "./plan.ts";
import type { FieldError as GenericFieldError } from "./result.ts";
import { instantToLocal, localToInstant } from "./timezone.ts";
import { distanceToMeters, type Units } from "./units.ts";

/** The viewer's place is never more precise than 1/50° (0.02°, about 2 km; decision D35). */
export const NEARBY_GRID_PER_DEGREE = 50;
export const NEARBY_RADII_KM = [5, 10, 25, 50] as const;
export type NearbyRadius = (typeof NEARBY_RADII_KM)[number];
export const DEFAULT_RADIUS_KM: NearbyRadius = 25;
/** Without dates: the next two weeks, as far as plans may lie ahead. */
const DEFAULT_DAYS = 14;
const DECIMAL = /^\d+(?:[.,]\d+)?$/;

/** Query string names, also the form's field names. */
export const NEARBY_FIELDS = [
  // A typed place, looked up with the geocoder; wins over coordinates.
  "place",
  "lat",
  "lng",
  "radius",
  "from",
  "to",
  "activity",
  "distanceFrom",
  "distanceTo",
  "paceFrom",
  "paceTo",
] as const;
export type NearbyField = (typeof NEARBY_FIELDS)[number];
/** Raw query values; empty strings mean "not given". */
export type NearbyInput = Record<NearbyField, string>;
export type NearbyFieldError = GenericFieldError<NearbyField>;

export const nearbyInput = (read: (field: NearbyField) => string = () => ""): NearbyInput =>
  Object.fromEntries(NEARBY_FIELDS.map((field) => [field, read(field)])) as NearbyInput;

export interface NearbyFilters {
  radiusKm: NearbyRadius;
  /** Start of the first day. */
  from: Date;
  /** Start of the day after the last one. */
  to: Date;
  activity: ActivityType | undefined;
  /** Meters; either end may be open. */
  distance: { min: number | undefined; max: number | undefined } | undefined;
  /** Seconds per km; a plan matches when its band overlaps. */
  pace: PaceBand | undefined;
}

/** The viewer's coordinates on the grid; undefined unless both are given. */
export function viewerPoint(
  input: Pick<NearbyInput, "lat" | "lng">,
): GeoPoint | "invalid" | undefined {
  const [lat, lng] = [input.lat.trim(), input.lng.trim()];
  if (lat === "" || lng === "") return undefined;
  const number = (text: string) => (/^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : Number.NaN);
  const point = validateGeoPoint({ lat: number(lat), lng: number(lng) });
  return point.ok ? onGrid(point.value) : "invalid";
}

/** Any point, such as a typed place's, on the viewer's grid. */
export const onGrid = (point: GeoPoint): GeoPoint => ({
  lat: snapToGrid(point.lat, NEARBY_GRID_PER_DEGREE),
  lng: snapToGrid(point.lng, NEARBY_GRID_PER_DEGREE),
});

/**
 * The form's dates and choices: the radius, the days in the instance's zone (from its start to
 * the end of the last day, up to the plan horizon), the activity, a distance range in the
 * viewer's units, and a pace or speed range in the style of the chosen activity.
 */
export function validateNearbyFilters(
  input: NearbyInput,
  rules: { now: Date; horizonDays: number; timeZone: string; units: Units },
): { ok: true; value: NearbyFilters } | { ok: false; errors: NearbyFieldError[] } {
  const errors: NearbyFieldError[] = [];
  const fail = (field: NearbyField, code: string): undefined => {
    errors.push({ field, code });
    return undefined;
  };

  const radiusText = input.radius.trim();
  const radiusKm =
    radiusText === ""
      ? DEFAULT_RADIUS_KM
      : (NEARBY_RADII_KM as readonly number[]).includes(Number(radiusText)) &&
          /^\d+$/.test(radiusText)
        ? (Number(radiusText) as NearbyRadius)
        : fail("radius", "choice_invalid");

  const days = nearbyDays(rules);
  const date = (field: "from" | "to", fallback: string): string | undefined => {
    const text = input[field].trim() || fallback;
    return localToInstant(text, "00:00", rules.timeZone).ok ? text : fail(field, "date_invalid");
  };
  const firstDay = date("from", days.from);
  // Without a last day: two weeks from the first, as far as plans may lie ahead.
  const lastDay =
    firstDay === undefined
      ? undefined
      : date("to", minDate(addDays(firstDay, DEFAULT_DAYS - 1), days.last));
  const from = firstDay === undefined ? undefined : startOf(firstDay, rules.timeZone);
  // The end is the start of the day after the last one.
  const to = lastDay === undefined ? undefined : startOf(addDays(lastDay, 1), rules.timeZone);
  if (firstDay !== undefined && firstDay > days.last) fail("from", "date_too_far");
  else if (firstDay !== undefined && lastDay !== undefined) {
    if (lastDay < firstDay) fail("to", "range_invalid");
    else if (lastDay > days.last) fail("to", "date_too_far");
  }

  const activityText = input.activity.trim();
  const activity =
    activityText === ""
      ? undefined
      : (ACTIVITY_TYPES as readonly string[]).includes(activityText)
        ? (activityText as ActivityType)
        : fail("activity", "choice_invalid");

  const meters = (field: "distanceFrom" | "distanceTo") => {
    const text = input[field].trim();
    if (text === "") return undefined;
    return DECIMAL.test(text)
      ? Math.round(distanceToMeters(Number(text.replace(",", ".")), rules.units))
      : fail(field, "number_invalid");
  };
  const [minMeters, maxMeters] = [meters("distanceFrom"), meters("distanceTo")];
  const distance =
    minMeters === undefined && maxMeters === undefined
      ? undefined
      : {
          min:
            minMeters === undefined || maxMeters === undefined
              ? minMeters
              : Math.min(minMeters, maxMeters),
          max:
            minMeters === undefined || maxMeters === undefined
              ? maxMeters
              : Math.max(minMeters, maxMeters),
        };

  const paceValue = (field: "paceFrom" | "paceTo"): number | undefined => {
    const text = input[field].trim();
    if (text === "") return undefined;
    if (activity === undefined) {
      return activityText === "" ? fail(field, "pace_needs_activity") : undefined;
    }
    const result =
      paceStyleFor(activity) === "pace"
        ? parsePace(text, rules.units)
        : /^\d+$/.test(text)
          ? paceFromSpeed(Number(text), rules.units)
          : { ok: false as const, error: "speed_invalid" };
    return result.ok ? result.value : fail(field, result.error);
  };
  const paces = [paceValue("paceFrom"), paceValue("paceTo")].filter(
    (value): value is number => value !== undefined,
  );
  const pace =
    paces.length === 0 ? undefined : { fastest: Math.min(...paces), slowest: Math.max(...paces) };

  if (errors.length > 0 || radiusKm === undefined || from === undefined || to === undefined) {
    return { ok: false, errors };
  }
  return { ok: true, value: { radiusKm, from, to, activity, distance, pace } };
}

/**
 * The days the form shows when none were chosen: today and the 13 after it in the zone, ending
 * earlier when plans may not lie that far ahead; `last` is the last day a plan may start on.
 */
export function nearbyDays(rules: { now: Date; horizonDays: number; timeZone: string }): {
  from: string;
  to: string;
  last: string;
} {
  const today = instantToLocal(rules.now, rules.timeZone).date;
  // A whole day short of the horizon, so its start is always within it.
  const last = addDays(today, Math.max(0, rules.horizonDays - 1));
  return { from: today, to: minDate(addDays(today, DEFAULT_DAYS - 1), last), last };
}

/** Calendar arithmetic on "YYYY-MM-DD", free of clock changes. */
function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const minDate = (a: string, b: string) => (a < b ? a : b);

/** Midnight of the day in the zone (a skipped midnight moves on, as localToInstant does). */
function startOf(date: string, zone: string): Date {
  const start = localToInstant(date, "00:00", zone);
  if (!start.ok) throw new Error(`not a date: ${date}`);
  return start.value;
}

export type NearbyCandidate = Pick<
  Plan,
  "visibility" | "status" | "startsAt" | "area" | "activity" | "distanceMeters" | "pace"
>;

/** Whether a plan is listed: public, active, upcoming, with a point, and matching every filter. */
export function matchesNearby(
  plan: NearbyCandidate,
  center: GeoPoint,
  filters: NearbyFilters,
  now: Date,
): boolean {
  const point = plan.area.point;
  if (plan.visibility !== "public" || plan.status !== "active" || point === undefined) return false;
  const starts = plan.startsAt.getTime();
  if (starts < now.getTime() || starts < filters.from.getTime() || starts >= filters.to.getTime()) {
    return false;
  }
  if (distanceMeters(center, point) > filters.radiusKm * 1000) return false;
  if (filters.activity !== undefined && plan.activity !== filters.activity) return false;
  const { distance, pace } = filters;
  if (distance !== undefined) {
    // A plan that does not say how far is left out once a distance is asked for.
    const meters = plan.distanceMeters;
    if (meters === undefined) return false;
    if (distance.min !== undefined && meters < distance.min) return false;
    if (distance.max !== undefined && meters > distance.max) return false;
  }
  if (pace !== undefined) {
    if (plan.pace === undefined) return false;
    if (plan.pace.fastest > pace.slowest || plan.pace.slowest < pace.fastest) return false;
  }
  return true;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  /** One range, or two where the box crosses ±180°; every longitude near a pole. */
  lngRanges: readonly (readonly [number, number])[];
}

/** A box holding every point within `radius` meters, for the index (spec 4: visibility, area). */
export function boundingBox(center: GeoPoint, radius: number): BoundingBox {
  const latDelta = (radius / 111_000) * 1.01;
  const minLat = Math.max(-90, center.lat - latDelta);
  const maxLat = Math.min(90, center.lat + latDelta);
  // The circle reaches a pole: it holds every longitude there.
  if (Math.abs(center.lat) + latDelta >= 89) return { minLat, maxLat, lngRanges: [[-180, 180]] };
  const lngDelta = latDelta / Math.cos(((Math.abs(center.lat) + latDelta) * Math.PI) / 180);
  if (lngDelta >= 180) return { minLat, maxLat, lngRanges: [[-180, 180]] };
  const [west, east] = [center.lng - lngDelta, center.lng + lngDelta];
  const lngRanges: [number, number][] =
    west < -180
      ? [
          [west + 360, 180],
          [-180, east],
        ]
      : east > 180
        ? [
            [west, 180],
            [-180, east - 360],
          ]
        : [[west, east]];
  return { minLat, maxLat, lngRanges };
}

/** Whether a point lies in the box. */
export const inBox = (box: BoundingBox, point: GeoPoint): boolean =>
  point.lat >= box.minLat &&
  point.lat <= box.maxLat &&
  box.lngRanges.some(([west, east]) => point.lng >= west && point.lng <= east);
