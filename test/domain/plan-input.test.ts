import { describe, expect, it } from "vite-plus/test";
import { type PlanInput, validatePlanInput } from "../../src/domain/plan-input.ts";

const rules = { now: new Date("2026-06-01T08:00:00Z"), horizonDays: 180, maxRetentionDays: 30 };

const valid: PlanInput = {
  posterName: "Anna",
  activity: "run",
  title: "Easy Sunday run",
  note: "Bring water.\nWe wait for everyone.",
  date: "2026-06-07",
  time: "07:30",
  timeZone: "Europe/Berlin",
  areaLabel: "Englischer Garten, north end",
  areaLat: "",
  areaLng: "",
  exactDescription: "",
  exactLat: "",
  exactLng: "",
  distanceKm: "12.5",
  elevationGainM: "",
  paceFrom: "5:30",
  paceTo: "6:00",
  dropPolicy: "no_drop",
  primaryColor: "#2e5bff",
  secondaryColor: "#FF7A45",
  retentionDays: "",
};

function draft(overrides: Partial<PlanInput> = {}) {
  const result = validatePlanInput({ ...valid, ...overrides }, rules, "metric");
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

function errors(overrides: Partial<PlanInput>) {
  const result = validatePlanInput({ ...valid, ...overrides }, rules, "metric");
  if (result.ok) throw new Error("expected errors");
  return result.errors;
}

describe("validatePlanInput (spec 5 feature 1)", () => {
  it("produces a complete draft with computed fields", () => {
    expect(draft()).toEqual({
      posterName: "Anna",
      activity: "run",
      title: "Easy Sunday run",
      note: "Bring water.\nWe wait for everyone.",
      startsAt: new Date("2026-06-07T05:30:00Z"),
      timeZone: "Europe/Berlin",
      area: { label: "Englischer Garten, north end", point: undefined },
      exactStart: undefined,
      distanceMeters: 12500,
      elevationGainMeters: undefined,
      pace: { fastest: 330, slowest: 360 },
      dropPolicy: "no_drop",
      colors: { primary: "#2E5BFF", secondary: "#FF7A45" },
      retentionDays: 14,
      recapWindow: "1w",
      deleteAt: new Date("2026-06-21T05:30:00Z"),
    });
  });

  it("reports every invalid field at once", () => {
    const found = errors({ posterName: "", title: "", date: "2026-02-30", primaryColor: "red" });
    expect(found).toEqual([
      { field: "posterName", code: "required" },
      { field: "title", code: "required" },
      { field: "date", code: "datetime_invalid" },
      { field: "primaryColor", code: "color_invalid" },
    ]);
  });

  describe("text fields (decision D7)", () => {
    it("trims and enforces length limits counted in characters", () => {
      expect(draft({ posterName: "  Anna  " }).posterName).toBe("Anna");
      expect(draft({ posterName: "é".repeat(50) }).posterName).toHaveLength(50);
      expect(errors({ posterName: "x".repeat(51) })).toEqual([
        { field: "posterName", code: "too_long" },
      ]);
      expect(errors({ title: "x".repeat(101) })).toEqual([{ field: "title", code: "too_long" }]);
      expect(errors({ areaLabel: "x".repeat(101) })).toEqual([
        { field: "areaLabel", code: "too_long" },
      ]);
      expect(errors({ note: "x".repeat(2001) })).toEqual([{ field: "note", code: "too_long" }]);
    });

    it("allows line breaks only in the note and rejects control characters", () => {
      expect(errors({ title: "Line\nbreak" })).toEqual([
        { field: "title", code: "invalid_characters" },
      ]);
      expect(errors({ note: "bell\u0007" })).toEqual([
        { field: "note", code: "invalid_characters" },
      ]);
      expect(draft({ note: "a\r\nb" }).note).toBe("a\nb");
      expect(draft({ note: "   " }).note).toBeUndefined();
    });

    it("requires name, title and area label", () => {
      expect(errors({ areaLabel: " " })).toEqual([{ field: "areaLabel", code: "required" }]);
    });
  });

  describe("start time (spec 3.1 Start date)", () => {
    it("must be in the future and within the horizon", () => {
      expect(errors({ date: "2026-05-31" })).toEqual([{ field: "date", code: "starts_in_past" }]);
      expect(errors({ date: "2027-01-01" })).toEqual([
        { field: "date", code: "starts_beyond_horizon" },
      ]);
    });

    it("requires a valid IANA time zone", () => {
      expect(errors({ timeZone: "+01:00" })).toEqual([
        { field: "timeZone", code: "timezone_invalid" },
      ]);
    });
  });

  describe("areas and exact start (spec 3.1, decision D2)", () => {
    it("snaps an area point to the public grid", () => {
      expect(draft({ areaLat: "48.15432", areaLng: "11.58861" }).area.point).toEqual({
        lat: 48.15,
        lng: 11.59,
      });
    });

    it("derives the public point from the exact start, never exposing the exact coordinates", () => {
      const result = draft({
        exactLat: "48.16321",
        exactLng: "11.60147",
        exactDescription: "North gate",
      });
      expect(result.exactStart).toEqual({
        point: { lat: 48.16321, lng: 11.60147 },
        description: "North gate",
      });
      expect(result.area.point).toEqual({ lat: 48.16, lng: 11.6 });
    });

    it("accepts a description without coordinates", () => {
      expect(draft({ exactDescription: "By the bike racks" }).exactStart).toEqual({
        point: undefined,
        description: "By the bike racks",
      });
    });

    it("requires both coordinates of a pair", () => {
      expect(errors({ exactLat: "48.1" })).toEqual([
        { field: "exactLat", code: "coordinates_invalid" },
      ]);
      expect(errors({ areaLat: "91", areaLng: "11" })).toEqual([
        { field: "areaLat", code: "coordinates_invalid" },
      ]);
    });

    it("limits the exact start description to 200 characters", () => {
      expect(errors({ exactDescription: "x".repeat(201) })).toEqual([
        { field: "exactDescription", code: "exact_start_too_long" },
      ]);
    });
  });

  describe("distance and elevation", () => {
    it("are optional and stored as whole meters", () => {
      expect(draft({ distanceKm: "" }).distanceMeters).toBeUndefined();
      expect(draft({ distanceKm: "10,25" }).distanceMeters).toBe(10250);
      expect(draft({ elevationGainM: "350" }).elevationGainMeters).toBe(350);
    });

    it("are range-checked", () => {
      expect(errors({ distanceKm: "0" })).toEqual([{ field: "distanceKm", code: "out_of_range" }]);
      expect(errors({ distanceKm: "1000.1" })).toEqual([
        { field: "distanceKm", code: "out_of_range" },
      ]);
      expect(errors({ distanceKm: "abc" })).toEqual([
        { field: "distanceKm", code: "number_invalid" },
      ]);
      expect(errors({ elevationGainM: "20001" })).toEqual([
        { field: "elevationGainM", code: "out_of_range" },
      ]);
      expect(errors({ elevationGainM: "1.5" })).toEqual([
        { field: "elevationGainM", code: "number_invalid" },
      ]);
    });
  });

  describe("pace band (spec 3.1 Pace, decisions D3 and D6)", () => {
    it("reads min:ss for runs in either order, or a single value", () => {
      expect(draft({ paceFrom: "6:00", paceTo: "5:30" }).pace).toEqual({
        fastest: 330,
        slowest: 360,
      });
      expect(draft({ paceFrom: "5:45", paceTo: "" }).pace).toEqual({ fastest: 345, slowest: 345 });
      expect(draft({ paceFrom: "", paceTo: "" }).pace).toBeUndefined();
    });

    it("reads whole km/h for rides", () => {
      expect(draft({ activity: "ride", paceFrom: "25", paceTo: "28" }).pace).toEqual({
        fastest: 129,
        slowest: 144,
      });
    });

    it("rejects input in the wrong style or out of range", () => {
      expect(errors({ activity: "ride", paceFrom: "5:30", paceTo: "" })).toEqual([
        { field: "paceFrom", code: "speed_invalid" },
      ]);
      expect(errors({ paceFrom: "0:50", paceTo: "" })).toEqual([
        { field: "paceFrom", code: "pace_out_of_range" },
      ]);
    });
  });

  describe("choices", () => {
    it("rejects unknown activities and drop policies", () => {
      expect(errors({ activity: "swim" })).toEqual([{ field: "activity", code: "choice_invalid" }]);
      expect(errors({ dropPolicy: "maybe" })).toEqual([
        { field: "dropPolicy", code: "choice_invalid" },
      ]);
    });
  });

  describe("retention (spec 3.10, decision D4)", () => {
    it("defaults to 14 days and picks the recap window that fits", () => {
      expect(draft({ retentionDays: "3" })).toMatchObject({ retentionDays: 3, recapWindow: "1d" });
    });

    it("respects the instance maximum", () => {
      const result = validatePlanInput(
        { ...valid, retentionDays: "" },
        { ...rules, maxRetentionDays: 5 },
        "metric",
      );
      expect(result.ok && result.value.retentionDays).toBe(5);
      expect(errors({ retentionDays: "31" })).toEqual([
        { field: "retentionDays", code: "retention_out_of_range" },
      ]);
    });
  });
});
