import { describe, expect, it } from "vite-plus/test";
import { calendarEnd } from "../../src/domain/calendar.ts";

const MINUTE = 60 * 1000;
const start = new Date("2026-06-07T05:30:00Z");
const minutes = (plan: Parameters<typeof calendarEnd>[0]) =>
  (calendarEnd(plan).getTime() - start.getTime()) / MINUTE;

describe("calendarEnd (decision I40)", () => {
  it("estimates the duration from the distance at the slowest pace, rounded up to 15 minutes", () => {
    // 10 km at 6:00 per km: 60 minutes.
    expect(
      minutes({ startsAt: start, distanceMeters: 10_000, pace: { fastest: 300, slowest: 360 } }),
    ).toBe(60);
    // 42.2 km at 2:30 per km: 105.5 minutes.
    expect(
      minutes({ startsAt: start, distanceMeters: 42_200, pace: { fastest: 120, slowest: 150 } }),
    ).toBe(120);
  });

  it("is 2 hours without a distance or a pace", () => {
    expect(minutes({ startsAt: start, distanceMeters: undefined, pace: undefined })).toBe(120);
    expect(minutes({ startsAt: start, distanceMeters: 10_000, pace: undefined })).toBe(120);
    expect(
      minutes({ startsAt: start, distanceMeters: undefined, pace: { fastest: 1, slowest: 2 } }),
    ).toBe(120);
  });

  it("stays between 15 minutes and 24 hours", () => {
    expect(
      minutes({ startsAt: start, distanceMeters: 100, pace: { fastest: 60, slowest: 60 } }),
    ).toBe(15);
    expect(
      minutes({ startsAt: start, distanceMeters: 300_000, pace: { fastest: 600, slowest: 1800 } }),
    ).toBe(24 * 60);
  });
});
