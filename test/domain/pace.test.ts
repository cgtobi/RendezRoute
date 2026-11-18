import { describe, expect, it } from "vite-plus/test";
import { ACTIVITY_TYPES, paceStyleFor } from "../../src/domain/activity.ts";
import {
  formatPace,
  formatSpeed,
  PACE_LIMITS,
  paceFromSpeed,
  parsePace,
  validatePaceBand,
} from "../../src/domain/pace.ts";

describe("paceStyleFor (spec 3.1 Pace, decision D3)", () => {
  it("shows runs and hikes as pace and rides as speed", () => {
    expect(ACTIVITY_TYPES.map((activity) => [activity, paceStyleFor(activity)])).toEqual([
      ["run", "pace"],
      ["trail", "pace"],
      ["hike", "pace"],
      ["ride", "speed"],
      ["gravel", "speed"],
      ["mtb", "speed"],
    ]);
  });
});

describe("pace (min:ss per km or mile)", () => {
  it("parses and formats metric pace exactly", () => {
    expect(parsePace("5:30", "metric")).toEqual({ ok: true, value: 330 });
    expect(formatPace(330, "metric")).toBe("5:30");
    expect(formatPace(305, "metric")).toBe("5:05");
  });

  it("converts imperial pace via seconds per km", () => {
    expect(parsePace("8:00", "imperial")).toEqual({ ok: true, value: 298 });
    expect(formatPace(298, "imperial")).toBe("8:00");
  });

  it("round-trips imperial pace within one second", () => {
    for (let seconds = 4 * 60; seconds <= 20 * 60; seconds++) {
      const input = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      const stored = parsePace(input, "imperial");
      if (!stored.ok) throw new Error(`rejected ${input}`);
      const [m, s] = formatPace(stored.value, "imperial").split(":").map(Number) as [
        number,
        number,
      ];
      expect(Math.abs(m * 60 + s - seconds)).toBeLessThanOrEqual(1);
    }
  });

  it("rejects malformed input", () => {
    for (const input of ["", "5", "5:60", "5:5", "-5:00", "abc", "5:30:00"]) {
      expect(parsePace(input, "metric")).toEqual({ ok: false, error: "pace_invalid" });
    }
  });
});

describe("speed (whole km/h or mph, decision D3)", () => {
  it("round-trips every whole km/h from 2 to 60 through s/km storage", () => {
    for (let kmh = 2; kmh <= 60; kmh++) {
      const stored = paceFromSpeed(kmh, "metric");
      if (!stored.ok) throw new Error(`rejected ${kmh}`);
      expect(Number.isInteger(stored.value)).toBe(true);
      expect(formatSpeed(stored.value, "metric")).toBe(String(kmh));
    }
  });

  it("round-trips every whole mph from 2 to 37 through s/km storage", () => {
    for (let mph = 2; mph <= 37; mph++) {
      const stored = paceFromSpeed(mph, "imperial");
      if (!stored.ok) throw new Error(`rejected ${mph}`);
      expect(formatSpeed(stored.value, "imperial")).toBe(String(mph));
    }
  });

  it("rejects non-whole and non-positive speeds", () => {
    for (const speed of [0, -3, 25.5, Number.NaN]) {
      expect(paceFromSpeed(speed, "metric")).toEqual({ ok: false, error: "speed_invalid" });
    }
  });
});

describe("validatePaceBand", () => {
  it("accepts a band whose faster end comes first", () => {
    expect(validatePaceBand({ fastest: 300, slowest: 360 })).toEqual({
      ok: true,
      value: { fastest: 300, slowest: 360 },
    });
    expect(validatePaceBand({ fastest: 330, slowest: 330 }).ok).toBe(true);
  });

  it("rejects reversed bands and values outside the limits", () => {
    expect(validatePaceBand({ fastest: 360, slowest: 300 })).toEqual({
      ok: false,
      error: "pace_band_reversed",
    });
    expect(validatePaceBand({ fastest: PACE_LIMITS.fastest - 1, slowest: 300 })).toEqual({
      ok: false,
      error: "pace_out_of_range",
    });
    expect(validatePaceBand({ fastest: 300, slowest: PACE_LIMITS.slowest + 1 })).toEqual({
      ok: false,
      error: "pace_out_of_range",
    });
  });
});
