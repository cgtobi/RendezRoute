import { describe, expect, it } from "vite-plus/test";
import { judgeNewPlans, newPlanCaps, storageLevel } from "../../src/domain/instance-limits.ts";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

describe("newPlanCaps", () => {
  it("is 200 a day and 40 an hour by default", () => {
    expect(newPlanCaps(200)).toEqual({ perDay: 200, perHour: 40 });
  });

  it("keeps the hourly cap at most the daily one", () => {
    expect(newPlanCaps(25)).toEqual({ perDay: 25, perHour: 25 });
    expect(newPlanCaps(0)).toEqual({ perDay: 0, perHour: 0 });
  });
});

describe("judgeNewPlans", () => {
  const caps = newPlanCaps(200);

  it("allows plans under both caps", () => {
    expect(judgeNewPlans(caps, { lastHour: 39, lastDay: 199 })).toEqual({ allowed: true });
  });

  it("refuses at the hourly cap, with a shorter retry time", () => {
    expect(judgeNewPlans(caps, { lastHour: 40, lastDay: 40 })).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });
  });

  it("refuses at the daily cap", () => {
    expect(judgeNewPlans(caps, { lastHour: 3, lastDay: 200 })).toEqual({
      allowed: false,
      retryAfterSeconds: 3600,
    });
  });

  it("refuses everything when paused with 0", () => {
    expect(judgeNewPlans(newPlanCaps(0), { lastHour: 0, lastDay: 0 }).allowed).toBe(false);
  });
});

describe("storageLevel", () => {
  it.each([
    // [free, total, level]
    [100 * MiB, 10 * GiB, "critical"],
    [511 * MiB, 100 * GiB, "critical"],
    // Under 512 MiB but not under 3 %: a small disk is not critical yet.
    [400 * MiB, 4 * GiB, "low"],
    // Under 3 % but not under 512 MiB: a huge disk is not critical.
    [1900 * MiB, 1000 * GiB, "low"],
    [1 * GiB, 20 * GiB, "low"],
    // 2 GiB or 10 % free is fine, as is a huge disk with a small share free.
    [2 * GiB, 20 * GiB, "ok"],
    [150 * GiB, 1000 * GiB, "ok"],
    [50 * GiB, 1000 * GiB, "ok"],
    [1 * GiB, 5 * GiB, "ok"],
  ] as const)("%i free of %i is %s", (freeBytes, totalBytes, level) => {
    expect(storageLevel({ freeBytes, totalBytes })).toBe(level);
  });

  it("treats a disk of unknown size with nothing free as critical, never dividing by zero", () => {
    expect(storageLevel({ freeBytes: 0, totalBytes: 0 })).toBe("critical");
  });
});
