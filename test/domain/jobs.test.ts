import { describe, expect, it } from "vite-plus/test";
import { nextRetryAt } from "../../src/domain/jobs.ts";

describe("nextRetryAt (decision I36)", () => {
  const now = new Date("2026-11-08T10:00:00Z");
  const after = (failures: number) => nextRetryAt(failures, now)?.toISOString();

  it("backs off after 1 min, 5 min, 30 min, 2 h and 6 h", () => {
    expect([1, 2, 3, 4, 5].map(after)).toEqual([
      "2026-11-08T10:01:00.000Z",
      "2026-11-08T10:05:00.000Z",
      "2026-11-08T10:30:00.000Z",
      "2026-11-08T12:00:00.000Z",
      "2026-11-08T16:00:00.000Z",
    ]);
  });

  it("gives up after the fifth retry", () => {
    expect(after(6)).toBeUndefined();
  });
});
