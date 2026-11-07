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
