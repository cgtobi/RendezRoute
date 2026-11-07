import { describe, expect, it } from "vite-plus/test";
import { validateTimeZone } from "../../src/domain/timezone.ts";

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
