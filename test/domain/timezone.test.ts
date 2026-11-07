import { describe, expect, it } from "vite-plus/test";
import { instantToLocal, localToInstant, validateTimeZone } from "../../src/domain/timezone.ts";

describe("validateTimeZone (spec 3.1 Time)", () => {
  it("accepts IANA zones and returns their canonical name", () => {
    expect(validateTimeZone("Europe/Berlin")).toEqual({ ok: true, value: "Europe/Berlin" });
    expect(validateTimeZone("utc")).toEqual({ ok: true, value: "UTC" });
  });

  it("rejects offsets, unknown zones and empty input", () => {
    for (const zone of ["+01:00", "-0530", "Mars/Olympus_Mons", "", "  "]) {
      expect(validateTimeZone(zone)).toEqual({ ok: false, error: "timezone_invalid" });
    }
  });
});

describe("localToInstant (spec 3.1: times are entered in the plan's time zone)", () => {
  const iso = (date: string, time: string, zone: string) => {
    const result = localToInstant(date, time, zone);
    if (!result.ok) throw new Error(result.error);
    return result.value.toISOString();
  };

  it("converts local wall-clock time to UTC", () => {
    expect(iso("2026-06-07", "07:30", "Europe/Berlin")).toBe("2026-06-07T05:30:00.000Z");
    expect(iso("2026-01-10", "07:30", "Europe/Berlin")).toBe("2026-01-10T06:30:00.000Z");
    expect(iso("2026-06-07", "07:30", "America/New_York")).toBe("2026-06-07T11:30:00.000Z");
    expect(iso("2026-06-07", "07:30", "UTC")).toBe("2026-06-07T07:30:00.000Z");
    expect(iso("2026-06-07", "07:30", "Asia/Kolkata")).toBe("2026-06-07T02:00:00.000Z");
  });

  it("moves a time that does not exist (spring-forward gap) forward", () => {
    expect(iso("2026-03-29", "02:30", "Europe/Berlin")).toBe("2026-03-29T01:30:00.000Z"); // 03:30 CEST
  });

  it("resolves a repeated time (fall-back overlap) to one of its occurrences", () => {
    expect(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]).toContain(
      iso("2026-10-25", "02:30", "Europe/Berlin"),
    );
  });

  it("rejects malformed or impossible dates and times", () => {
    for (const [date, time] of [
      ["2026-02-30", "07:30"],
      ["2026-13-01", "07:30"],
      ["07.06.2026", "07:30"],
      ["2026-06-07", "24:00"],
      ["2026-06-07", "7:30"],
      ["", ""],
    ] as const) {
      expect(localToInstant(date, time, "Europe/Berlin")).toEqual({
        ok: false,
        error: "datetime_invalid",
      });
    }
  });
});

describe("instantToLocal", () => {
  it("shows an instant as wall-clock date and time in a zone, inverting localToInstant", () => {
    expect(instantToLocal(new Date("2026-06-07T05:30:00Z"), "Europe/Berlin")).toEqual({
      date: "2026-06-07",
      time: "07:30",
    });
    expect(instantToLocal(new Date("2026-01-01T00:15:00Z"), "America/New_York")).toEqual({
      date: "2025-12-31",
      time: "19:15",
    });
    for (const [date, time] of [
      ["2026-06-07", "07:30"],
      ["2026-12-31", "23:59"],
      ["2026-03-29", "03:30"],
    ] as const) {
      const instant = localToInstant(date, time, "Europe/Berlin");
      if (!instant.ok) throw new Error("invalid");
      expect(instantToLocal(instant.value, "Europe/Berlin")).toEqual({ date, time });
    }
  });
});
