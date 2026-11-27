import { describe, expect, it } from "vite-plus/test";
import {
  CONTRIBUTION_LIMITS,
  changeRecapWindow,
  fitRecapWindow,
  hasRecap,
  isRecapOpen,
  recapClosesAt,
  shortenedRecapWindow,
  validateContribution,
} from "../../src/domain/recap.ts";
import type { RecapWindow } from "../../src/domain/schedule.ts";

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2026-06-07T05:30:00Z");
const plan = (
  overrides: Partial<Parameters<typeof recapClosesAt>[0]> & {
    status?: "active" | "cancelled";
  } = {},
) => ({
  startsAt: start,
  status: "active" as "active" | "cancelled",
  recapWindow: "1w" as RecapWindow,
  recapWindowSetAt: undefined as Date | undefined,
  recapClosedAt: undefined as Date | undefined,
  deleteAt: new Date(start.getTime() + 14 * DAY),
  ...overrides,
});
const at = (offsetMs: number) => new Date(start.getTime() + offsetMs);

describe("recapClosesAt (spec 6 feature 6)", () => {
  it("measures the window from the start, never beyond deletion", () => {
    expect(recapClosesAt(plan())).toEqual(at(7 * DAY));
    expect(recapClosesAt(plan({ recapWindow: "1d" }))).toEqual(at(DAY));
    expect(recapClosesAt(plan({ recapWindow: "now" }))).toEqual(start);
    expect(recapClosesAt(plan({ deleteAt: at(5 * DAY) }))).toEqual(at(5 * DAY));
  });

  it("measures from the change when the window was changed after the start", () => {
    expect(recapClosesAt(plan({ recapWindow: "1d", recapWindowSetAt: at(3 * DAY) }))).toEqual(
      at(4 * DAY),
    );
    expect(
      recapClosesAt(
        plan({ recapWindow: "now", recapWindowSetAt: at(DAY), recapClosedAt: at(DAY) }),
      ),
    ).toEqual(at(DAY));
  });
});

describe("isRecapOpen", () => {
  it("is open from the start until it closes, never for cancelled plans", () => {
    expect(isRecapOpen(plan(), at(-1))).toBe(false);
    expect(isRecapOpen(plan(), start)).toBe(true);
    expect(isRecapOpen(plan(), at(7 * DAY - 1))).toBe(true);
    expect(isRecapOpen(plan(), at(7 * DAY))).toBe(false);
    expect(isRecapOpen(plan({ status: "cancelled" }), at(DAY))).toBe(false);
  });
});

describe("changeRecapWindow (spec 6 feature 6)", () => {
  it("before the start only sets the window", () => {
    expect(changeRecapWindow(plan(), "1d", at(-DAY))).toEqual({
      recapWindow: "1d",
      recapWindowSetAt: undefined,
      recapClosedAt: undefined,
    });
  });

  it("after the start measures from now, and closes at once for “now”", () => {
    expect(changeRecapWindow(plan(), "1d", at(2 * DAY))).toEqual({
      recapWindow: "1d",
      recapWindowSetAt: at(2 * DAY),
      recapClosedAt: undefined,
    });
    expect(changeRecapWindow(plan(), "now", at(2 * DAY))).toEqual({
      recapWindow: "now",
      recapWindowSetAt: at(2 * DAY),
      recapClosedAt: at(2 * DAY),
    });
  });

  it("reopens a closed recap when the host picks a window again (decision I42)", () => {
    const closed = plan({ recapWindow: "now", recapWindowSetAt: at(DAY), recapClosedAt: at(DAY) });
    const reopened = { ...closed, ...changeRecapWindow(closed, "1d", at(2 * DAY)) };
    expect(isRecapOpen(reopened, at(2 * DAY))).toBe(true);
    expect(recapClosesAt(reopened)).toEqual(at(3 * DAY));
  });

  it("keeps everything when the window is unchanged", () => {
    const changed = plan({ recapWindow: "1d", recapWindowSetAt: at(DAY) });
    expect(changeRecapWindow(changed, "1d", at(2 * DAY))).toEqual({
      recapWindow: "1d",
      recapWindowSetAt: at(DAY),
      recapClosedAt: undefined,
    });
  });
});

describe("fitRecapWindow (decision D4: only shrinks automatically)", () => {
  it("shortens a window longer than the retention to the largest that fits", () => {
    expect(fitRecapWindow("1w", 14)).toBe("1w");
    expect(fitRecapWindow("1w", 6)).toBe("1d");
    expect(fitRecapWindow("1d", 1)).toBe("1d");
    expect(fitRecapWindow("now", 30)).toBe("now");
  });
});

describe("shortenedRecapWindow (spec 3.10: the form says so)", () => {
  it("is the stored window only when it differs from a chosen one", () => {
    expect(shortenedRecapWindow("1w", "1d")).toBe("1d");
    expect(shortenedRecapWindow("1d", "1d")).toBeUndefined();
    expect(shortenedRecapWindow("", "1d")).toBeUndefined();
  });
});

describe("hasRecap (spec 6 feature 5)", () => {
  it("is true from the start of an active plan on", () => {
    expect(hasRecap(plan(), at(-1))).toBe(false);
    expect(hasRecap(plan(), start)).toBe(true);
    expect(hasRecap(plan({ status: "cancelled" }), at(DAY))).toBe(false);
  });
});

describe("validateContribution (spec 6 feature 5)", () => {
  it("takes a comment, a link or both, trimmed", () => {
    expect(validateContribution({ body: "  Great run! ", linkUrl: "" })).toEqual({
      ok: true,
      value: { body: "Great run!", linkUrl: undefined },
    });
    expect(
      validateContribution({ body: "", linkUrl: " https://www.strava.com/activities/1 " }),
    ).toEqual({
      ok: true,
      value: { body: undefined, linkUrl: "https://www.strava.com/activities/1" },
    });
  });

  it("refuses empty contributions, long ones and links that are not web addresses", () => {
    const errors = (body: string, linkUrl: string) => {
      const result = validateContribution({ body, linkUrl });
      return result.ok ? [] : result.errors;
    };
    expect(errors(" ", " ")).toEqual([{ field: "body", code: "contribution_empty" }]);
    expect(errors("x".repeat(CONTRIBUTION_LIMITS.body + 1), "")).toEqual([
      { field: "body", code: "contribution_too_long" },
    ]);
    expect(errors("", "javascript:alert(1)")).toEqual([{ field: "linkUrl", code: "link_invalid" }]);
    expect(errors("", "strava.com/activities/1")).toEqual([
      { field: "linkUrl", code: "link_invalid" },
    ]);
    expect(errors("", `https://example.org/${"a".repeat(CONTRIBUTION_LIMITS.linkUrl)}`)).toEqual([
      { field: "linkUrl", code: "link_too_long" },
    ]);
  });
});

describe("validateContribution: web addresses in the comment (decision D95)", () => {
  it("takes at most three", () => {
    const three = "https://a.example https://b.example https://c.example";
    expect(validateContribution({ body: three, linkUrl: "" }).ok).toBe(true);
    expect(validateContribution({ body: `${three} https://d.example`, linkUrl: "" })).toEqual({
      ok: false,
      errors: [{ field: "body", code: "too_many_urls" }],
    });
  });
});

describe("validateContribution: control and bidi characters in the comment (decision D96)", () => {
  it("refuses them with the form's code", () => {
    for (const body of ["a\u202Eb", "a\u0007b"]) {
      expect(validateContribution({ body, linkUrl: "" })).toEqual({
        ok: false,
        errors: [{ field: "body", code: "invalid_characters" }],
      });
    }
    expect(validateContribution({ body: "x".repeat(1001), linkUrl: "" })).toEqual({
      ok: false,
      errors: [{ field: "body", code: "contribution_too_long" }],
    });
  });
});
