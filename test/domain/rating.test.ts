import { describe, expect, it } from "vite-plus/test";
import {
  canRate,
  RATING_LIMITS,
  ratingResult,
  ratingResultVisible,
  type RatingResult,
  ratingsClosedAtAfter,
  ratingTallyBeforeChange,
  validateRating,
} from "../../src/domain/rating.ts";
import type { RecapWindow } from "../../src/domain/schedule.ts";

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2026-06-07T05:30:00Z");
const at = (offsetMs: number) => new Date(start.getTime() + offsetMs);
const plan = (
  overrides: {
    status?: "active" | "cancelled";
    recapWindow?: RecapWindow;
    ratingsClosedAt?: Date;
    ratingTally?: RatingResult;
  } = {},
) => ({
  startsAt: start,
  status: "active" as "active" | "cancelled",
  recapWindow: "1w" as RecapWindow,
  recapWindowSetAt: undefined,
  recapClosedAt: undefined,
  ratingsClosedAt: undefined as Date | undefined,
  ratingTally: undefined as RatingResult | undefined,
  deleteAt: at(14 * DAY),
  ...overrides,
});

describe("canRate (spec 6a: participants, while the recap is open)", () => {
  it("lets participants rate while the recap is open", () => {
    expect(canRate(plan(), "joined", at(DAY))).toEqual({ ok: true, value: true });
  });

  it("refuses everyone else", () => {
    for (const kind of ["interested", "requested", "rejected", "removed"] as const) {
      expect(canRate(plan(), kind, at(DAY))).toEqual({ ok: false, error: "not_participant" });
    }
  });

  it("refuses before the start, after the close and for cancelled plans", () => {
    expect(canRate(plan(), "joined", at(-1))).toEqual({ ok: false, error: "rating_closed" });
    expect(canRate(plan(), "joined", at(7 * DAY))).toEqual({ ok: false, error: "rating_closed" });
    expect(canRate(plan({ status: "cancelled" }), "joined", at(DAY))).toEqual({
      ok: false,
      error: "rating_closed",
    });
  });
});

describe("frozen ratings (decision D20: a reopened recap does not reopen ratings)", () => {
  it("freezes ratings at the first close when the window is changed after it", () => {
    expect(ratingsClosedAtAfter(plan(), at(DAY))).toBeUndefined();
    expect(ratingsClosedAtAfter(plan(), at(-1))).toBeUndefined();
    expect(ratingsClosedAtAfter(plan(), at(8 * DAY))).toEqual(at(7 * DAY));
    expect(ratingsClosedAtAfter(plan({ ratingsClosedAt: at(2 * DAY) }), at(9 * DAY))).toEqual(
      at(2 * DAY),
    );
  });

  it("keeps a frozen plan closed for rating, with its result shown", () => {
    const frozen = plan({ ratingsClosedAt: at(7 * DAY) });
    expect(canRate(frozen, "joined", at(DAY))).toEqual({ ok: false, error: "rating_closed" });
    expect(ratingResultVisible(frozen, 3, at(DAY), 3)).toBe(true);
  });
});

describe("validateRating", () => {
  it("takes up or down and an optional note of up to 500 characters", () => {
    expect(validateRating({ value: "up", note: "" })).toEqual({
      ok: true,
      value: { value: "up", note: undefined },
    });
    expect(validateRating({ value: "down", note: "  Too fast.\nNice route.  " })).toEqual({
      ok: true,
      value: { value: "down", note: "Too fast.\nNice route." },
    });
    expect(validateRating({ value: "up", note: "é".repeat(RATING_LIMITS.note) }).ok).toBe(true);
  });

  it("reports every problem at once", () => {
    expect(validateRating({ value: "meh", note: "x".repeat(RATING_LIMITS.note + 1) })).toEqual({
      ok: false,
      errors: [
        { field: "value", code: "choice_invalid" },
        { field: "note", code: "too_long" },
      ],
    });
  });
});

describe("ratingResultVisible (spec 6a: the host, after the close, from the minimum)", () => {
  it("shows the result once the recap has closed and at least the minimum could rate", () => {
    expect(ratingResultVisible(plan(), 3, at(7 * DAY), 3)).toBe(true);
    expect(ratingResultVisible(plan(), 3, at(7 * DAY - 1), 3)).toBe(false);
    expect(ratingResultVisible(plan(), 2, at(8 * DAY), 3)).toBe(false);
    expect(ratingResultVisible(plan({ status: "cancelled" }), 5, at(8 * DAY), 3)).toBe(false);
  });

  it("follows the configured minimum", () => {
    expect(ratingResultVisible(plan(), 2, at(8 * DAY), 2)).toBe(true);
    expect(ratingResultVisible(plan(), 1, at(8 * DAY), 2)).toBe(false);
    expect(ratingResultVisible(plan(), 3, at(8 * DAY), 4)).toBe(false);
    expect(ratingResultVisible(plan(), 4, at(8 * DAY), 4)).toBe(true);
    expect(ratingResultVisible(plan(), 50, at(8 * DAY), 50)).toBe(true);
  });
});

describe("the stored tally (decision D20: fixed once anything changes after the close)", () => {
  it("is taken only once ratings have closed, and then kept", () => {
    expect(ratingTallyBeforeChange(plan(), ["up"], 3, at(DAY))).toBeUndefined();
    const tally = { participants: 4, rated: 2, up: 1, down: 1 };
    expect(ratingTallyBeforeChange(plan(), ["up", "down"], 4, at(8 * DAY))).toEqual(tally);
    expect(ratingTallyBeforeChange(plan({ ratingTally: tally }), ["up"], 3, at(9 * DAY))).toEqual(
      tally,
    );
  });

  it("decides the minimum rule once stored, against the current minimum", () => {
    const tally = { participants: 3, rated: 1, up: 1, down: 0 };
    expect(ratingResultVisible(plan({ ratingTally: tally }), 2, at(8 * DAY), 3)).toBe(true);
    expect(ratingResultVisible(plan({ ratingTally: tally }), 9, at(8 * DAY), 4)).toBe(false);
    expect(ratingResultVisible(plan({ ratingTally: tally }), 1, at(8 * DAY), 2)).toBe(true);
  });
});

describe("ratingResult", () => {
  it("counts ratings against participants, never as a bare score", () => {
    expect(ratingResult(["up", "down", "up"], 7)).toEqual({
      participants: 7,
      rated: 3,
      up: 2,
      down: 1,
    });
  });
});
