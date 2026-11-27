import { describe, expect, it } from "vite-plus/test";
import {
  canChangeResponse,
  canRespond,
  isPosterName,
  validateDisplayName,
} from "../../src/domain/responding.ts";

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

describe("validateDisplayName (spec 3.5, decision D7)", () => {
  it("trims and accepts names up to 50 characters", () => {
    expect(validateDisplayName("  Ben ", "Anna")).toEqual({ ok: true, value: "Ben" });
    expect(validateDisplayName("é".repeat(50), "Anna").ok).toBe(true);
  });

  it("rejects empty, too long and multi-line names", () => {
    expect(validateDisplayName("  ", "Anna")).toEqual({ ok: false, error: "required" });
    expect(validateDisplayName("x".repeat(51), "Anna")).toEqual({ ok: false, error: "too_long" });
    expect(validateDisplayName("Ben\nB", "Anna")).toEqual({
      ok: false,
      error: "invalid_characters",
    });
  });

  it("rejects exactly the poster's name, so the host badge stays unambiguous", () => {
    expect(validateDisplayName("ANNA", "Anna")).toEqual({ ok: false, error: "name_taken_by_host" });
  });
});

describe("canChangeResponse (spec 5 feature 6)", () => {
  const plan = { startsAt, status: "active" as const };
  const before = new Date("2026-06-01T00:00:00Z");

  it("lets interested and joined people switch before the start", () => {
    expect(canChangeResponse({ kind: "interested" }, plan, before)).toEqual({
      ok: true,
      value: true,
    });
    expect(canChangeResponse({ kind: "joined" }, plan, before)).toEqual({ ok: true, value: true });
  });

  it("closes switching at the start and for cancelled plans, like new responses", () => {
    expect(canChangeResponse({ kind: "joined" }, plan, startsAt)).toEqual({
      ok: false,
      error: "plan_started",
    });
    expect(canChangeResponse({ kind: "joined" }, { ...plan, status: "cancelled" }, before)).toEqual(
      {
        ok: false,
        error: "plan_cancelled",
      },
    );
  });

  it("never lets removed or rejected people back in (spec 3.5)", () => {
    expect(canChangeResponse({ kind: "removed" }, plan, before)).toEqual({
      ok: false,
      error: "blocked",
    });
    expect(canChangeResponse({ kind: "rejected" }, plan, before)).toEqual({
      ok: false,
      error: "blocked",
    });
  });
});

describe("validateDisplayName: web addresses (decision D95)", () => {
  it("refuses an address in a name", () => {
    expect(validateDisplayName("Ben https://spam.example", "Anna")).toEqual({
      ok: false,
      error: "urls_not_allowed",
    });
    expect(validateDisplayName("Ben", "Anna")).toEqual({ ok: true, value: "Ben" });
  });
});
