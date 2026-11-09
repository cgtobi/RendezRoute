import { describe, expect, it } from "vite-plus/test";
import { REPORT_LIMITS, validateReport } from "../../src/domain/report.ts";

describe("validateReport (spec 7 Moderation)", () => {
  it("accepts a reason with optional details", () => {
    expect(validateReport({ reason: "spam", details: "" })).toEqual({
      ok: true,
      value: { reason: "spam", details: undefined },
    });
    expect(validateReport({ reason: "unsafe", details: "  Line one\nline two  " })).toEqual({
      ok: true,
      value: { reason: "unsafe", details: "Line one\nline two" },
    });
  });

  it("refuses an unknown reason and overlong details", () => {
    expect(
      validateReport({ reason: "boring", details: "x".repeat(REPORT_LIMITS.details + 1) }),
    ).toEqual({
      ok: false,
      errors: [
        { field: "reason", code: "choice_invalid" },
        { field: "details", code: "too_long" },
      ],
    });
  });
});
