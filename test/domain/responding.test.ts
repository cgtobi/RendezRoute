import { describe, expect, it } from "vite-plus/test";
import { canRespond, isPosterName } from "../../src/domain/responding.ts";

const startsAt = new Date("2026-06-07T07:30:00Z");

describe("canRespond (spec 3.1 Responding)", () => {
  it("allows responses to an active plan before it starts", () => {
    expect(canRespond({ startsAt, status: "active" }, new Date("2026-06-07T07:29:59Z"))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("refuses responses from the start time on", () => {
    expect(canRespond({ startsAt, status: "active" }, startsAt)).toEqual({
      ok: false,
      error: "plan_started",
    });
  });

  it("refuses responses to cancelled plans (decision D6)", () => {
    expect(canRespond({ startsAt, status: "cancelled" }, new Date("2026-06-01T00:00:00Z"))).toEqual(
      {
        ok: false,
        error: "plan_cancelled",
      },
    );
  });
});

describe("isPosterName (spec 3.5 Host badge)", () => {
  it("matches the poster's display name case-insensitively and ignoring surrounding spaces", () => {
    expect(isPosterName("  anna ", "Anna")).toBe(true);
    expect(isPosterName("ÄNNE", "änne")).toBe(true);
    expect(isPosterName("Anna B.", "Anna")).toBe(false);
  });

  it("ignores differences in runs of whitespace", () => {
    expect(isPosterName("Anna  B.", "Anna B.")).toBe(true);
    expect(isPosterName("Anna\u00a0B.", "Anna B.")).toBe(true);
  });

  it("treats canonically equivalent Unicode spellings as equal", () => {
    expect(isPosterName("Amélie", "Amélie")).toBe(true);
  });
});
