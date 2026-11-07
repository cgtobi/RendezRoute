import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_RETENTION_DAYS,
  defaultRecapWindow,
  defaultRetentionDays,
  deleteAt,
  recapWindowDays,
  validateRetention,
  validateStartsAt,
} from "../../src/domain/schedule.ts";

const now = new Date("2026-06-01T08:00:00Z");

describe("validateStartsAt (spec 3.1 Start date)", () => {
  it("requires a future start within the plan horizon", () => {
    expect(validateStartsAt(new Date("2026-06-01T08:00:01Z"), now, 180).ok).toBe(true);
    expect(validateStartsAt(new Date("2026-11-28T08:00:00Z"), now, 180).ok).toBe(true);
    expect(validateStartsAt(now, now, 180)).toEqual({ ok: false, error: "starts_in_past" });
    expect(validateStartsAt(new Date("2026-05-31T08:00:00Z"), now, 180)).toEqual({
      ok: false,
      error: "starts_in_past",
    });
    expect(validateStartsAt(new Date("2026-11-28T08:00:01Z"), now, 180)).toEqual({
      ok: false,
      error: "starts_beyond_horizon",
    });
  });

  it("rejects invalid dates", () => {
    expect(validateStartsAt(new Date("garbage"), now, 180)).toEqual({
      ok: false,
      error: "starts_invalid",
    });
  });

  it("respects a lowered MAX_PLAN_HORIZON_DAYS", () => {
    expect(validateStartsAt(new Date("2026-06-10T08:00:00Z"), now, 7)).toEqual({
      ok: false,
      error: "starts_beyond_horizon",
    });
  });
});

describe("retention (spec 3.10)", () => {
  it("defaults to 14 days, or the instance maximum if lower", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(14);
    expect(defaultRetentionDays(30)).toBe(14);
    expect(defaultRetentionDays(3)).toBe(3);
  });

  it("computes delete_at as starts_at plus whole days", () => {
    expect(deleteAt(new Date("2026-06-07T07:30:00Z"), 14).toISOString()).toBe(
      "2026-06-21T07:30:00.000Z",
    );
    expect(deleteAt(new Date("2026-06-07T07:30:00Z"), 1).toISOString()).toBe(
      "2026-06-08T07:30:00.000Z",
    );
  });

  it("accepts whole days from 1 to the instance maximum", () => {
    expect(validateRetention(1, "1d", 30)).toEqual({ ok: true, value: 1 });
    expect(validateRetention(30, "1w", 30)).toEqual({ ok: true, value: 30 });
    for (const days of [0, 31, 7.5, Number.NaN]) {
      expect(validateRetention(days, "now", 30)).toEqual({
        ok: false,
        error: "retention_out_of_range",
      });
    }
    expect(validateRetention(10, "1w", 7)).toEqual({ ok: false, error: "retention_out_of_range" });
  });

  it("must be at least the recap window", () => {
    expect(recapWindowDays).toEqual({ now: 0, "1d": 1, "1w": 7 });
    expect(validateRetention(6, "1w", 30)).toEqual({
      ok: false,
      error: "retention_shorter_than_recap_window",
    });
    expect(validateRetention(7, "1w", 30).ok).toBe(true);
  });
});

describe("defaultRecapWindow (spec 3.10, decision D4)", () => {
  it.each([
    [1, "1d"],
    [6, "1d"],
    [7, "1w"],
    [30, "1w"],
  ] as const)("is %i days → %s", (days, window) => {
    expect(defaultRecapWindow(days)).toBe(window);
    expect(validateRetention(days, defaultRecapWindow(days), 30).ok).toBe(true);
  });

  it("fits the default retention when MAX_RETENTION_DAYS = 3", () => {
    const retention = defaultRetentionDays(3);
    expect(validateRetention(retention, defaultRecapWindow(retention), 3).ok).toBe(true);
  });
});
