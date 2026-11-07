// Start date, retention and recap window rules (spec 3.1, 3.10).
import { err, ok, type Result } from "./result.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const RECAP_WINDOWS = ["now", "1d", "1w"] as const;
export type RecapWindow = (typeof RECAP_WINDOWS)[number];

export const recapWindowDays: Readonly<Record<RecapWindow, number>> = { now: 0, "1d": 1, "1w": 7 };

export const DEFAULT_RETENTION_DAYS = 14;
/** Hard upper bound; instances may only lower it (MAX_RETENTION_DAYS). */
export const RETENTION_DAYS_LIMIT = 30;

export function validateStartsAt(
  startsAt: Date,
  now: Date,
  horizonDays: number,
): Result<Date, "starts_invalid" | "starts_in_past" | "starts_beyond_horizon"> {
  // Invalid dates compare false with everything, so check explicitly.
  if (Number.isNaN(startsAt.getTime())) return err("starts_invalid");
  if (startsAt.getTime() <= now.getTime()) return err("starts_in_past");
  if (startsAt.getTime() > now.getTime() + horizonDays * DAY_MS)
    return err("starts_beyond_horizon");
  return ok(startsAt);
}

export function defaultRetentionDays(instanceMax: number): number {
  return Math.min(DEFAULT_RETENTION_DAYS, instanceMax);
}

/** Largest recap window that fits the retention (decision D4). */
export function defaultRecapWindow(retentionDays: number): RecapWindow {
  return retentionDays >= recapWindowDays["1w"] ? "1w" : "1d";
}

export function validateRetention(
  retentionDays: number,
  recapWindow: RecapWindow,
  instanceMax: number,
): Result<number, "retention_out_of_range" | "retention_shorter_than_recap_window"> {
  const max = Math.min(instanceMax, RETENTION_DAYS_LIMIT);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > max) {
    return err("retention_out_of_range");
  }
  if (retentionDays < recapWindowDays[recapWindow])
    return err("retention_shorter_than_recap_window");
  return ok(retentionDays);
}

/** delete_at is always computed, never set directly (spec 3.1 Retention edits). */
export function deleteAt(startsAt: Date, retentionDays: number): Date {
  return new Date(startsAt.getTime() + retentionDays * DAY_MS);
}
