import { describe, expect, it } from "vite-plus/test";
import {
  dayBeforeReminderAt,
  dayBeforeReminderDue,
  deletionReminderAt,
  deletionReminderDue,
  reminderWindows,
  startsToday,
} from "../../src/domain/reminders.ts";
import { recapClosesAt } from "../../src/domain/recap.ts";
import type { RecapWindow } from "../../src/domain/schedule.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const plan = (
  startsAt: string,
  {
    timeZone = "Europe/Berlin",
    status = "active" as "active" | "cancelled",
    retentionDays = 14,
    recapWindow = "1w" as RecapWindow,
  } = {},
) => {
  const start = new Date(startsAt);
  return {
    startsAt: start,
    timeZone,
    status,
    recapWindow,
    recapWindowSetAt: undefined,
    recapClosedAt: undefined,
    deleteAt: new Date(start.getTime() + retentionDays * DAY),
  };
};

describe("day-before reminder (spec 6 feature 3)", () => {
  it("is at 18:00 in the plan's zone on the day before", () => {
    // 07:30 in Berlin (summer time) on 7 June; 18:00 on 6 June is 16:00 UTC.
    expect(dayBeforeReminderAt(plan("2026-06-07T05:30:00Z"))).toEqual(
      new Date("2026-06-06T16:00:00Z"),
    );
    expect(dayBeforeReminderAt(plan("2026-06-07T05:30:00Z", { timeZone: "UTC" }))).toEqual(
      new Date("2026-06-06T18:00:00Z"),
    );
    // Across a month boundary and a DST change (29 March 2026 in Berlin).
    expect(dayBeforeReminderAt(plan("2026-03-30T06:00:00Z"))).toEqual(
      new Date("2026-03-29T16:00:00Z"),
    );
    expect(dayBeforeReminderAt(plan("2026-03-01T08:00:00Z"))).toEqual(
      new Date("2026-02-28T17:00:00Z"),
    );
  });

  it("is 18:00 the day before also when the clocks change in between", () => {
    // Summer time starts at 02:00 on 29 March 2026: 18:00 the day before is still winter time.
    expect(dayBeforeReminderAt(plan("2026-03-29T05:30:00Z"))).toEqual(
      new Date("2026-03-28T17:00:00Z"),
    );
    // Summer time ends at 03:00 on 25 October 2026: 18:00 the day before is still summer time.
    expect(dayBeforeReminderAt(plan("2026-10-25T22:59:00Z"))).toEqual(
      new Date("2026-10-24T16:00:00Z"),
    );
  });

  it("is due from that moment on, or at once for people who join later", () => {
    const p = plan("2026-06-07T05:30:00Z");
    expect(dayBeforeReminderDue(p, new Date("2026-06-06T15:59:59Z"))).toBeUndefined();
    expect(dayBeforeReminderDue(p, new Date("2026-06-06T16:00:00Z"))).toEqual(
      new Date("2026-06-06T16:00:00Z"),
    );
    expect(dayBeforeReminderDue(p, new Date("2026-06-06T22:00:00Z"))).toEqual(
      new Date("2026-06-06T16:00:00Z"),
    );
  });

  it("is skipped when the start is less than 3 hours away, and for cancelled plans", () => {
    const p = plan("2026-06-07T05:30:00Z");
    expect(dayBeforeReminderDue(p, new Date("2026-06-07T02:30:00Z"))).toBeDefined();
    expect(dayBeforeReminderDue(p, new Date("2026-06-07T02:30:01Z"))).toBeUndefined();
    expect(
      dayBeforeReminderDue({ ...p, status: "cancelled" }, new Date("2026-06-06T20:00:00Z")),
    ).toBeUndefined();
  });
});

describe("deletion reminder (spec 3.10)", () => {
  it("is at the later of two days before deletion and the recap close", () => {
    // 14 days, recap 1 week: two days before deletion is later.
    expect(deletionReminderAt(plan("2026-06-07T05:30:00Z"))).toEqual(
      new Date("2026-06-19T05:30:00Z"),
    );
    // 8 days, recap 1 week: the recap close is later.
    expect(deletionReminderAt(plan("2026-06-07T05:30:00Z", { retentionDays: 8 }))).toEqual(
      new Date("2026-06-14T05:30:00Z"),
    );
  });

  it("measures the recap close from the start, never beyond deletion", () => {
    expect(recapClosesAt(plan("2026-06-07T05:30:00Z", { recapWindow: "1d" }))).toEqual(
      new Date("2026-06-08T05:30:00Z"),
    );
    expect(
      recapClosesAt(plan("2026-06-07T05:30:00Z", { recapWindow: "now", retentionDays: 1 })),
    ).toEqual(new Date("2026-06-07T05:30:00Z"));
    expect(
      recapClosesAt({
        ...plan("2026-06-07T05:30:00Z", { retentionDays: 7 }),
        deleteAt: new Date("2026-06-10T05:30:00Z"),
      }),
    ).toEqual(new Date("2026-06-10T05:30:00Z"));
  });

  it("is due from that moment until 6 hours before deletion", () => {
    const p = plan("2026-06-07T05:30:00Z");
    expect(deletionReminderDue(p, new Date("2026-06-19T05:29:59Z"))).toBeUndefined();
    expect(deletionReminderDue(p, new Date("2026-06-19T05:30:00Z"))).toEqual(
      new Date("2026-06-19T05:30:00Z"),
    );
    expect(deletionReminderDue(p, new Date("2026-06-20T23:30:00Z"))).toBeDefined();
    expect(deletionReminderDue(p, new Date("2026-06-20T23:30:01Z"))).toBeUndefined();
  });

  it("is skipped when its moment is less than 6 hours before deletion, and for cancelled plans", () => {
    // 7 days with a 1-week recap: the recap closes at deletion.
    const tight = plan("2026-06-07T05:30:00Z", { retentionDays: 7 });
    expect(deletionReminderDue(tight, new Date("2026-06-14T05:00:00Z"))).toBeUndefined();
    const cancelled = plan("2026-06-07T05:30:00Z", { status: "cancelled" });
    expect(deletionReminderDue(cancelled, new Date("2026-06-19T06:00:00Z"))).toBeUndefined();
  });
});

describe("startsToday", () => {
  it("compares calendar days in the plan's zone", () => {
    const p = plan("2026-06-07T05:30:00Z");
    // 23:59 and 00:00 in Berlin.
    expect(startsToday(p, new Date("2026-06-06T21:59:00Z"))).toBe(false);
    expect(startsToday(p, new Date("2026-06-06T22:00:00Z"))).toBe(true);
  });
});

describe("reminderWindows", () => {
  it("contain every plan that can have a reminder due now, also at the longest lead", () => {
    // 23:59 on 25 October, the day summer time ends: 18:00 the day before is 31 hours earlier.
    const latest = plan("2026-10-25T22:59:00Z");
    const now = dayBeforeReminderAt(latest) ?? new Date(0);
    const [from, to] = reminderWindows(now).startsBetween;
    expect(latest.startsAt >= from && latest.startsAt <= to).toBe(true);
  });

  it("are 3 to 31 hours ahead for starts and 6 hours to 2 days for deletions", () => {
    const now = new Date("2026-06-06T16:00:00Z");
    const { startsBetween, deletesBetween } = reminderWindows(now);
    expect(startsBetween[0].getTime() - now.getTime()).toBe(3 * HOUR);
    expect(startsBetween[1].getTime() - now.getTime()).toBe(31 * HOUR);
    expect(deletesBetween[0].getTime() - now.getTime()).toBe(6 * HOUR);
    expect(deletesBetween[1].getTime() - now.getTime()).toBe(2 * DAY);
  });
});
