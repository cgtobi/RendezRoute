// Automatic expiry (spec 3.10 Plan retention, Other expiry; decision D9).
import type { Plan } from "./plan.ts";
import { defaultRecapWindow, deleteAt, type RecapWindow } from "./schedule.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Devices without links go after 30 days, any device after 12 months, counted from last activity. */
export const DEVICE_UNLINKED_DAYS = 30;
export const DEVICE_UNUSED_DAYS = 365;

export function deviceExpiryCutoffs(now: Date): {
  unlinkedLastSeenBefore: Date;
  anyLastSeenBefore: Date;
} {
  return {
    unlinkedLastSeenBefore: new Date(now.getTime() - DEVICE_UNLINKED_DAYS * DAY_MS),
    anyLastSeenBefore: new Date(now.getTime() - DEVICE_UNUSED_DAYS * DAY_MS),
  };
}

/** Pre-migration backups are deleted after 7 days, so they never outlive retention by more than a week (spec 11). */
export const BACKUP_DAYS = 7;

export function backupExpiryCutoff(now: Date): Date {
  return new Date(now.getTime() - BACKUP_DAYS * DAY_MS);
}

export type CappedRetention =
  | { kind: "unchanged" }
  | { kind: "shortened"; retentionDays: number; recapWindow: RecapWindow; deleteAt: Date }
  | { kind: "delete" };

/** A lowered MAX_RETENTION_DAYS applied to an existing plan (`apply-retention-max`, spec 3.10). */
export function capRetention(
  plan: Pick<Plan, "startsAt" | "retentionDays">,
  maxRetentionDays: number,
  now: Date,
): CappedRetention {
  if (plan.retentionDays <= maxRetentionDays) return { kind: "unchanged" };
  const newDeleteAt = deleteAt(plan.startsAt, maxRetentionDays);
  if (newDeleteAt.getTime() <= now.getTime()) return { kind: "delete" };
  return {
    kind: "shortened",
    retentionDays: maxRetentionDays,
    recapWindow: defaultRecapWindow(maxRetentionDays),
    deleteAt: newDeleteAt,
  };
}
