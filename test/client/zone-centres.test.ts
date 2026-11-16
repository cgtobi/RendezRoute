import { describe, expect, it } from "vite-plus/test";
import { ZONE_CENTRES } from "../../src/client/zone-centres.ts";
import { TIME_ZONES } from "../../src/adapters/in/http/routes/shared.tsx";

/** Zones the form offers that have no place, and why: UTC is no region (the tz database gives it none). */
const NO_CENTRE: readonly string[] = ["UTC"];

describe("ZONE_CENTRES (decision D63)", () => {
  it("has the main place of well-known zones", () => {
    const near = (zone: string, lat: number, lng: number) => {
      const [centreLat = 999, centreLng = 999] = ZONE_CENTRES[zone] ?? [];
      expect([zone, Math.abs(centreLat - lat) < 1, Math.abs(centreLng - lng) < 1]).toEqual([
        zone,
        true,
        true,
      ]);
    };
    near("Europe/Berlin", 52.5, 13.4);
    near("America/New_York", 40.7, -74);
    near("Asia/Kolkata", 22.5, 88.4);
    near("Pacific/Auckland", -36.9, 174.8);
    near("Asia/Tokyo", 35.7, 139.7);
  });

  it("is sorted by zone name and holds valid coordinates", () => {
    const names = Object.keys(ZONE_CENTRES);
    expect(names).toEqual(names.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const [zone, [lat, lng]] of Object.entries(ZONE_CENTRES)) {
      expect([zone, Math.abs(lat) <= 90, Math.abs(lng) <= 180]).toEqual([zone, true, true]);
    }
  });

  it("covers every zone the form offers, except those deliberately without a place", () => {
    const missing = TIME_ZONES.filter((zone) => ZONE_CENTRES[zone] === undefined);
    expect(missing).toEqual([...NO_CENTRE]);
  });

  it("lists no zone as absent that has a place", () => {
    expect(NO_CENTRE.filter((zone) => ZONE_CENTRES[zone] !== undefined)).toEqual([]);
  });
});
