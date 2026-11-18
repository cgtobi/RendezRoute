// A clock the end-to-end tests may move forward (decision D87, plan I102). Development only:
// the configuration refuses E2E_CLOCK_CONTROL unless ALLOW_INSECURE_DEV is on, and the control
// route exists only then.
//
// Design (13p):
// - Every consumer wired from the Clock port follows this clock: the use cases behind the HTTP
//   app and the admin listener, the job runner, the retention sweep and reminders, rate limiters,
//   CSRF day tokens of the Ingress listener, admin session expiry, the caches of geocoder, weather
//   and tiles, the Fedify key-value store, Web Push's VAPID `exp` and the channel repository.
// - Ambient time does NOT follow, on purpose: timers (the scheduler keeps its real 10 s and 60 s
//   cadence), the log line time, request durations, the geocoder throttle (relative waits), the
//   Telegram poller's pacing, and everything Fedify does by itself: the `Date` header it signs
//   outgoing requests with and the time window in which it accepts incoming signatures. Both use
//   real time, so an advance never skews a signature; no SQL compares times with datetime('now').
// - Offset only grows: the clock is the system time plus a sum of advances, so it keeps running
//   and never repeats a time. One call may advance at most a day, all calls together at most
//   seven days, so no mistake pushes data past its retention.
import type { Clock } from "../../application/ports.ts";
import { err, ok, type Result } from "../../domain/result.ts";

/** The most one call may advance the clock by. */
export const ADVANCE_CAP_MS = 24 * 60 * 60 * 1000;
/** The most all calls together may advance it. */
export const TOTAL_CAP_MS = 7 * 24 * 60 * 60 * 1000;

export interface ControllableClock extends Clock {
  /** Moves the clock forward by whole milliseconds; the new time, or why it was refused. */
  advance(ms: number): Result<Date, "invalid" | "too_large">;
}

/** `systemNow` returns the real time in milliseconds; tests inject their own. */
export function createControllableClock(systemNow: () => number = Date.now): ControllableClock {
  let offsetMs = 0;
  const now = () => new Date(systemNow() + offsetMs);
  return {
    now,
    advance(ms) {
      if (!Number.isInteger(ms) || ms < 0) return err("invalid");
      if (ms > ADVANCE_CAP_MS || offsetMs + ms > TOTAL_CAP_MS) return err("too_large");
      offsetMs += ms;
      return ok(now());
    },
  };
}
