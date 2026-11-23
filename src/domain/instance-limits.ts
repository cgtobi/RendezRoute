// Instance-wide limits (0.19.0 commit A, ADR 009): how many plans the whole instance takes in
// a day and an hour, and how much free disk it needs. Pure decisions; the counts and the free
// space come from the ports.

/** Ceiling of the daily cap; MAX_NEW_PLANS_PER_DAY can only lower it. */
export const MAX_NEW_PLANS_PER_DAY = 200;
/** Ceiling of the hourly cap; the hourly cap never exceeds the daily one. */
export const MAX_NEW_PLANS_PER_HOUR = 40;

export interface NewPlanCaps {
  perDay: number;
  perHour: number;
}

/** The caps for a configured daily cap: the hourly one is at most 40 and at most the daily one. */
export function newPlanCaps(perDay: number): NewPlanCaps {
  return { perDay, perHour: Math.min(MAX_NEW_PLANS_PER_HOUR, perDay) };
}

export type NewPlansVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Quarter of an hour: when the hourly cap is hit, room comes back within the hour. */
const HOURLY_RETRY_SECONDS = 900;
const DAILY_RETRY_SECONDS = 3600;

/** Whether the instance takes another plan, given how many were created in the last hour and day. */
export function judgeNewPlans(
  caps: NewPlanCaps,
  created: { lastHour: number; lastDay: number },
): NewPlansVerdict {
  if (created.lastDay >= caps.perDay) {
    return { allowed: false, retryAfterSeconds: DAILY_RETRY_SECONDS };
  }
  if (created.lastHour >= caps.perHour) {
    return { allowed: false, retryAfterSeconds: HOURLY_RETRY_SECONDS };
  }
  return { allowed: true };
}

/** Free and total bytes of the disk the data directory is on. */
export interface StorageSample {
  freeBytes: number;
  totalBytes: number;
}

export type StorageLevel = "ok" | "low" | "critical";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

/**
 * "critical" (new plans and route files are refused) when less than 512 MiB and less than 3 % are
 * free; "low" (a warning) when less than 2 GiB and less than 10 % are. Both parts must hold, so a
 * big shared disk with a small share free does not raise an alarm.
 */
export function storageLevel({ freeBytes, totalBytes }: StorageSample): StorageLevel {
  const share = totalBytes > 0 ? freeBytes / totalBytes : 0;
  if (freeBytes < 512 * MiB && share < 0.03) return "critical";
  if (freeBytes < 2 * GiB && share < 0.1) return "low";
  return "ok";
}
