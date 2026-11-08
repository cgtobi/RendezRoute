// Calendar entries (spec 6 feature 2, decision I40). Plans have no end time, so calendars get an
// estimate: the distance at the slowest pace of the band, or 2 hours without one.
import type { PaceBand } from "./pace.ts";

const MINUTE_MS = 60 * 1000;
const STEP_MS = 15 * MINUTE_MS;
const DEFAULT_DURATION_MS = 2 * 60 * MINUTE_MS;
const MAX_DURATION_MS = 24 * 60 * MINUTE_MS;

export function calendarEnd(plan: {
  startsAt: Date;
  distanceMeters: number | undefined;
  pace: PaceBand | undefined;
}): Date {
  const { distanceMeters, pace } = plan;
  const estimate =
    distanceMeters === undefined || pace === undefined
      ? DEFAULT_DURATION_MS
      : (distanceMeters / 1000) * pace.slowest * 1000;
  const rounded = Math.ceil(estimate / STEP_MS) * STEP_MS;
  const duration = Math.min(Math.max(rounded, STEP_MS), MAX_DURATION_MS);
  return new Date(plan.startsAt.getTime() + duration);
}
