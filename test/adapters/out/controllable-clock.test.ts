import { describe, expect, it } from "vite-plus/test";
import {
  ADVANCE_CAP_MS,
  createControllableClock,
  TOTAL_CAP_MS,
} from "../../../src/adapters/out/controllable-clock.ts";

const HOUR_MS = 60 * 60 * 1000;

/** A system time source the test moves by hand. */
function source(start = Date.parse("2026-06-01T08:00:00Z")) {
  const time = { at: start };
  return { time, read: () => time.at };
}

describe("controllableClock (decision D87)", () => {
  it("follows the system time source while nothing was advanced", () => {
    const { time, read } = source();
    const clock = createControllableClock(read);
    expect(clock.now().toISOString()).toBe("2026-06-01T08:00:00.000Z");
    time.at += 5_000;
    expect(clock.now().toISOString()).toBe("2026-06-01T08:00:05.000Z");
  });

  it("moves ahead of the source by what was advanced, and keeps running with it", () => {
    const { time, read } = source();
    const clock = createControllableClock(read);
    const advanced = clock.advance(3 * 60_000);
    expect(advanced).toEqual({ ok: true, value: new Date("2026-06-01T08:03:00Z") });
    time.at += 1_000;
    expect(clock.now().toISOString()).toBe("2026-06-01T08:03:01.000Z");
  });

  it("adds up several advances", () => {
    const { read } = source();
    const clock = createControllableClock(read);
    clock.advance(60_000);
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe("2026-06-01T08:02:00.000Z");
  });

  it("never goes back: negative, fractional and non-finite amounts change nothing", () => {
    const { read } = source();
    const clock = createControllableClock(read);
    for (const bad of [-1, -60_000, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clock.advance(bad)).toEqual({ ok: false, error: "invalid" });
    }
    expect(clock.now().toISOString()).toBe("2026-06-01T08:00:00.000Z");
  });

  it("accepts zero, which only reads the time", () => {
    const { read } = source();
    const clock = createControllableClock(read);
    expect(clock.advance(0)).toEqual({ ok: true, value: new Date("2026-06-01T08:00:00Z") });
  });

  it("refuses more than 24 hours in one call", () => {
    const { read } = source();
    const clock = createControllableClock(read);
    expect(clock.advance(ADVANCE_CAP_MS)).toMatchObject({ ok: true });
    expect(clock.advance(ADVANCE_CAP_MS + 1)).toEqual({ ok: false, error: "too_large" });
    expect(clock.now().toISOString()).toBe("2026-06-02T08:00:00.000Z");
  });

  it("refuses to pass 7 days in total, and still allows what fits", () => {
    const { read } = source();
    const clock = createControllableClock(read);
    for (let day = 0; day < 7; day += 1)
      expect(clock.advance(24 * HOUR_MS)).toMatchObject({ ok: true });
    expect(TOTAL_CAP_MS).toBe(7 * 24 * HOUR_MS);
    expect(clock.advance(1)).toEqual({ ok: false, error: "too_large" });
    expect(clock.now().toISOString()).toBe("2026-06-08T08:00:00.000Z");
  });
});
