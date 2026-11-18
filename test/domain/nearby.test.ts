// Nearby (spec 7 Visibility and Nearby plans, decision D35): the viewer's place on a coarse grid,
// the filters, and which plans match.
import { describe, expect, it } from "vite-plus/test";
import { distanceMeters } from "../../src/domain/geo.ts";
import {
  boundingBox,
  inBox,
  nearbyDays,
  matchesNearby,
  type NearbyFilters,
  type NearbyInput,
  nearbyInput,
  validateNearbyFilters,
  viewerPoint,
} from "../../src/domain/nearby.ts";
import { fixtureNow, samplePlan } from "../fixtures/plans.ts";

const rules = {
  now: fixtureNow,
  horizonDays: 180,
  timeZone: "Europe/Berlin",
  units: "metric" as const,
};
const input = (fields: Partial<NearbyInput> = {}): NearbyInput => ({ ...nearbyInput(), ...fields });
const filters = (fields: Partial<NearbyInput> = {}): NearbyFilters => {
  const result = validateNearbyFilters(input(fields), rules);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
};

describe("the viewer's place (decision D35)", () => {
  it("is rounded to the 0.02° grid, whatever the browser sent", () => {
    expect(viewerPoint(input({ lat: "48.15321", lng: "11.58911" }))).toEqual({
      lat: 48.16,
      lng: 11.58,
    });
    expect(viewerPoint(input({ lat: "48.14", lng: "11.6" }))).toEqual({ lat: 48.14, lng: 11.6 });
    expect(viewerPoint(input({ lat: "-0.009", lng: "0.011" }))).toEqual({ lat: 0, lng: 0.02 });
  });

  it("is missing without both coordinates, and refused when they are not coordinates", () => {
    expect(viewerPoint(input())).toBeUndefined();
    expect(viewerPoint(input({ lat: "48.1" }))).toBeUndefined();
    expect(viewerPoint(input({ lat: "91", lng: "11" }))).toBe("invalid");
    expect(viewerPoint(input({ lat: "north", lng: "11" }))).toBe("invalid");
  });
});

describe("the filters", () => {
  it("default to 25 km and the next 14 days in the instance's zone", () => {
    expect(filters()).toEqual({
      radiusKm: 25,
      from: new Date("2026-05-31T22:00:00Z"),
      to: new Date("2026-06-14T22:00:00Z"),
      activity: undefined,
      distance: undefined,
      pace: undefined,
    });
  });

  it("show those days on the form", () => {
    expect(nearbyDays(rules)).toEqual({ from: "2026-06-01", to: "2026-06-14", last: "2026-11-27" });
  });

  it("read the radius, dates, activity, distance and pace the viewer chose", () => {
    expect(
      filters({
        radius: "10",
        from: "2026-06-05",
        to: "2026-06-07",
        activity: "run",
        distanceFrom: "10",
        distanceTo: "21.1",
        paceFrom: "6:00",
        paceTo: "5:00",
      }),
    ).toEqual({
      radiusKm: 10,
      from: new Date("2026-06-04T22:00:00Z"),
      to: new Date("2026-06-07T22:00:00Z"),
      activity: "run",
      distance: { min: 10_000, max: 21_100 },
      pace: { fastest: 300, slowest: 360 },
    });
    // Hikes are filtered by pace, like runs.
    expect(filters({ activity: "hike", paceFrom: "12:00", paceTo: "10:00" })).toMatchObject({
      activity: "hike",
      pace: { fastest: 600, slowest: 720 },
    });
    // Speed for rides, in the viewer's units.
    expect(filters({ activity: "ride", paceFrom: "25", paceTo: "30" }).pace).toEqual({
      fastest: 120,
      slowest: 144,
    });
  });

  it("refuse what they cannot read, each on its field", () => {
    const errors = (fields: Partial<NearbyInput>) => {
      const result = validateNearbyFilters(input(fields), rules);
      return result.ok ? [] : result.errors;
    };
    expect(errors({ radius: "7" })).toEqual([{ field: "radius", code: "choice_invalid" }]);
    expect(errors({ activity: "swim" })).toEqual([{ field: "activity", code: "choice_invalid" }]);
    expect(errors({ from: "2026-06-10", to: "2026-06-05" })).toEqual([
      { field: "to", code: "range_invalid" },
    ]);
    expect(errors({ to: "2027-06-01" })).toEqual([{ field: "to", code: "date_too_far" }]);
    expect(errors({ from: "yesterday" })).toEqual([{ field: "from", code: "date_invalid" }]);
    expect(errors({ distanceFrom: "ten" })).toEqual([
      { field: "distanceFrom", code: "number_invalid" },
    ]);
    // Pace and speed are read in the activity's style.
    expect(errors({ paceFrom: "5:00" })).toEqual([
      { field: "paceFrom", code: "pace_needs_activity" },
    ]);
    expect(errors({ activity: "run", paceFrom: "fast" })).toEqual([
      { field: "paceFrom", code: "pace_invalid" },
    ]);
  });
});

describe("which plans match", () => {
  const center = { lat: 48.16, lng: 11.6 };
  const plan = samplePlan({
    visibility: "public",
    startsAt: new Date("2026-06-07T05:30:00Z"),
  });
  const matches = (overrides: Parameters<typeof samplePlan>[0], fields = {}) =>
    matchesNearby({ ...plan, ...overrides }, center, filters(fields), fixtureNow);

  it("only public, active, upcoming plans with a point within the radius", () => {
    expect(plan.area.point).toEqual({ lat: 48.16, lng: 11.6 });
    expect(matches({})).toBe(true);
    expect(matches({ visibility: "link" })).toBe(false);
    expect(matches({ status: "cancelled" })).toBe(false);
    expect(matches({ startsAt: new Date(fixtureNow.getTime() - 60_000) })).toBe(false);
    expect(matches({ area: { label: "Somewhere", point: undefined } })).toBe(false);
    // About 12 km north: in 25 km, not in 10 km.
    const north = { area: { label: "North", point: { lat: 48.27, lng: 11.6 } } };
    expect(matches(north)).toBe(true);
    expect(matches(north, { radius: "10" })).toBe(false);
  });

  it("within the dates, of the activity, distance and pace asked for", () => {
    expect(matches({}, { from: "2026-06-08" })).toBe(false);
    // The plan starts on 7 June: in with the 7th as the last day, out with the 6th.
    expect(matches({}, { to: "2026-06-07" })).toBe(true);
    expect(matches({}, { to: "2026-06-06" })).toBe(false);
    expect(matches({}, { activity: "ride" })).toBe(false);
    expect(matches({}, { activity: "hike" })).toBe(false);
    expect(matches({ activity: "hike" }, { activity: "hike" })).toBe(true);
    // 12.5 km at 5:30–6:00 min/km.
    expect(matches({}, { distanceFrom: "10", distanceTo: "15" })).toBe(true);
    expect(matches({}, { distanceFrom: "15" })).toBe(false);
    expect(matches({ distanceMeters: undefined }, { distanceFrom: "10" })).toBe(false);
    expect(matches({}, { activity: "run", paceFrom: "5:50", paceTo: "6:30" })).toBe(true);
    expect(matches({}, { activity: "run", paceFrom: "4:00", paceTo: "5:00" })).toBe(false);
    expect(matches({ pace: undefined }, { activity: "run", paceFrom: "5:00" })).toBe(false);
  });
});

describe("the bounding box", () => {
  /** Points around the centre on the radius's circle, a little inside it. */
  const ring = (center: { lat: number; lng: number }, meters: number) =>
    Array.from({ length: 36 }, (_, step) => {
      const bearing = (step * 10 * Math.PI) / 180;
      const d = (meters * 0.99) / 6_371_008.8;
      const [lat1, lng1] = [(center.lat * Math.PI) / 180, (center.lng * Math.PI) / 180];
      const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
      );
      const lng2 =
        lng1 +
        Math.atan2(
          Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
          Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
        );
      const lng = (((((lng2 * 180) / Math.PI + 540) % 360) + 360) % 360) - 180;
      return { lat: (lat2 * 180) / Math.PI, lng };
    });

  it("holds every point within the radius, also across ±180° and near a pole", () => {
    for (const center of [
      { lat: 48.16, lng: 11.6 },
      { lat: -17.7, lng: 179.9 },
      { lat: 65.7, lng: -179.95 },
      { lat: 89.8, lng: 0 },
      { lat: -89.9, lng: 120 },
    ]) {
      const box = boundingBox(center, 50_000);
      for (const point of ring(center, 50_000)) {
        expect(distanceMeters(center, point)).toBeLessThanOrEqual(50_000);
        expect(inBox(box, point), `${JSON.stringify(center)} → ${JSON.stringify(point)}`).toBe(
          true,
        );
      }
    }
  });

  it("stays small away from the poles, and splits at ±180°", () => {
    const munich = boundingBox({ lat: 48.16, lng: 11.6 }, 25_000);
    expect(munich.maxLat - munich.minLat).toBeLessThan(0.5);
    expect(munich.lngRanges).toHaveLength(1);
    expect(boundingBox({ lat: -17.7, lng: 179.9 }, 25_000).lngRanges).toHaveLength(2);
    expect(boundingBox({ lat: 89.9, lng: 0 }, 25_000).lngRanges).toEqual([[-180, 180]]);
  });
});

describe("the days", () => {
  it("end earlier when plans may not lie two weeks ahead", () => {
    const short = { ...rules, horizonDays: 7 };
    expect(nearbyDays(short)).toEqual({ from: "2026-06-01", to: "2026-06-07", last: "2026-06-07" });
    // The form's own defaults always pass.
    expect(validateNearbyFilters(input(nearbyDays(short)), short).ok).toBe(true);
    expect(validateNearbyFilters(input(), short).ok).toBe(true);
    const beyond = validateNearbyFilters(input({ from: "2026-06-10" }), short);
    expect(beyond.ok ? [] : beyond.errors).toEqual([{ field: "from", code: "date_too_far" }]);
  });

  it("are whole days in the zone, across a clock change", () => {
    // Late on the evening before the clocks go back (25 October 2026, Berlin).
    const autumn = { ...rules, now: new Date("2026-10-24T21:30:00Z") };
    expect(nearbyDays(autumn)).toMatchObject({ from: "2026-10-24", to: "2026-11-06" });
    const result = validateNearbyFilters(input({ from: "2026-10-25", to: "2026-10-25" }), autumn);
    expect(result.ok && [result.value.from, result.value.to]).toEqual([
      new Date("2026-10-24T22:00:00Z"),
      new Date("2026-10-25T23:00:00Z"),
    ]);
  });
});
