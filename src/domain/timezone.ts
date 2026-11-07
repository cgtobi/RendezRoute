// IANA time zone names (spec 3.1 Time). Intl is a language built-in, allowed in the domain.
import { err, ok, type Result } from "./result.ts";

/** Canonical IANA name, e.g. "utc" → "UTC". Offsets such as "+01:00" are not zones and are rejected. */
export function validateTimeZone(name: string): Result<string, "timezone_invalid"> {
  const trimmed = name.trim();
  if (trimmed === "") return err("timezone_invalid");
  try {
    const resolved = new Intl.DateTimeFormat("en", { timeZone: trimmed }).resolvedOptions()
      .timeZone;
    return /^[+-]/.test(resolved) ? err("timezone_invalid") : ok(resolved);
  } catch {
    return err("timezone_invalid");
  }
}

/** Offset of `zone` from UTC at `instant`, in milliseconds (positive east of Greenwich). */
function offsetAt(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const wallClock = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallClock - Math.floor(instant / 1000) * 1000;
}

/**
 * Instant of a wall-clock date ("YYYY-MM-DD") and time ("HH:MM") in an IANA zone.
 * Times skipped by a spring-forward change move forward by the gap; repeated times
 * resolve to one of their occurrences.
 */
export function localToInstant(
  date: string,
  time: string,
  zone: string,
): Result<Date, "datetime_invalid"> {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (d === null || t === null) return err("datetime_invalid");
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];

  const local = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(local);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return err("datetime_invalid"); // e.g. 2026-02-30
  }

  try {
    const first = local - offsetAt(local, zone);
    const second = offsetAt(first, zone);
    return ok(new Date(local - second));
  } catch {
    return err("datetime_invalid");
  }
}
