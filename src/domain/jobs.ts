// Background jobs (spec 6 feature 12, decision I36): retried with backoff, then given up.

/**
 * Notifications, and the emails that are not (decision D31): confirmation links, report alerts and
 * an account's own notices such as the expiry warning.
 */
export const JOB_TYPES = [
  "notification",
  "emailConfirmation",
  "reportAlert",
  "accountNotice",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

const MINUTE_MS = 60 * 1000;
/** Delays before the first to the fifth retry. */
const RETRY_DELAYS_MS = [1, 5, 30, 120, 360].map((minutes) => minutes * MINUTE_MS);

/** When to try again after the given number of failures, or undefined to give up. */
export function nextRetryAt(failures: number, now: Date): Date | undefined {
  const delay = RETRY_DELAYS_MS[failures - 1];
  return delay === undefined ? undefined : new Date(now.getTime() + delay);
}
