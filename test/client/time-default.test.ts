import { describe, expect, it } from "vite-plus/test";
import { nextQuarterHour } from "../../src/client/time-default.ts";

const at = (iso: string) => new Date(iso);

describe("nextQuarterHour", () => {
  it("rounds up to the next quarter hour", () => {
    expect(nextQuarterHour(at("2026-06-10T14:03:00Z"), "UTC")).toBe("14:15");
    expect(nextQuarterHour(at("2026-06-10T14:44:59Z"), "UTC")).toBe("14:45");
  });

  it("moves on when exactly on a quarter hour", () => {
    expect(nextQuarterHour(at("2026-06-10T14:15:00.000Z"), "UTC")).toBe("14:30");
    expect(nextQuarterHour(at("2026-06-10T14:00:00.000Z"), "UTC")).toBe("14:15");
  });

  it("counts seconds past a quarter hour as past it", () => {
    expect(nextQuarterHour(at("2026-06-10T14:00:30Z"), "UTC")).toBe("14:15");
  });

  it("wraps past midnight", () => {
    expect(nextQuarterHour(at("2026-06-10T23:50:00Z"), "UTC")).toBe("00:00");
    expect(nextQuarterHour(at("2026-06-10T23:45:00Z"), "UTC")).toBe("00:00");
  });

  it("uses the local minute in a +05:45 zone", () => {
    // 10:00 UTC is 15:45 in Kathmandu
    expect(nextQuarterHour(at("2026-06-10T10:00:00Z"), "Asia/Kathmandu")).toBe("16:00");
    expect(nextQuarterHour(at("2026-06-10T10:01:00Z"), "Asia/Kathmandu")).toBe("16:00");
    expect(nextQuarterHour(at("2026-06-10T10:20:00Z"), "Asia/Kathmandu")).toBe("16:15");
  });

  it("uses the local minute in a +05:30 zone", () => {
    // 10:00 UTC is 15:30 in Kolkata
    expect(nextQuarterHour(at("2026-06-10T10:00:00Z"), "Asia/Kolkata")).toBe("15:45");
    expect(nextQuarterHour(at("2026-06-10T10:50:00Z"), "Asia/Kolkata")).toBe("16:30");
  });

  it("handles a zone on the other side of the date line", () => {
    // 10:07 UTC is 23:07 the day before in Pago Pago (-11)
    expect(nextQuarterHour(at("2026-06-10T10:07:00Z"), "Pacific/Pago_Pago")).toBe("23:15");
    // 11:50 UTC is 01:50 on the next day in Kiritimati (+14)
    expect(nextQuarterHour(at("2026-06-10T11:50:00Z"), "Pacific/Kiritimati")).toBe("02:00");
  });

  it("follows the zone across a DST change", () => {
    // Berlin 2026-03-29: clocks jump 02:00 -> 03:00 at 01:00 UTC. 02:00 does not exist locally
    // that morning; it is only a time of day for the form (the date is chosen separately), kept as
    // given, as the app keeps any time a clock change skips (see src/domain/template.ts).
    expect(nextQuarterHour(at("2026-03-29T00:50:00Z"), "Europe/Berlin")).toBe("02:00");
    expect(nextQuarterHour(at("2026-03-29T01:03:00Z"), "Europe/Berlin")).toBe("03:15");
  });

  it("does not throw on an invalid zone and still returns a quarter hour", () => {
    expect(() => nextQuarterHour(at("2026-06-10T14:03:00Z"), "Not/AZone")).not.toThrow();
    expect(nextQuarterHour(at("2026-06-10T14:03:00Z"), "Not/AZone")).toMatch(
      /^\d{2}:(00|15|30|45)$/,
    );
  });

  it("always returns :00, :15, :30 or :45", () => {
    const zones = ["UTC", "Asia/Kathmandu", "Asia/Kolkata", "America/St_Johns", "Europe/Berlin"];
    const start = at("2026-06-10T00:00:00Z").getTime();
    for (const zone of zones) {
      for (let i = 0; i < 400; i += 1) {
        const value = nextQuarterHour(new Date(start + i * 7 * 60_000 + i * 1_234), zone);
        expect(value).toMatch(/^([01]\d|2[0-3]):(00|15|30|45)$/);
      }
    }
  });
});
