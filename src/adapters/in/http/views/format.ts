// Display formatting for the plan's time zone and units (spec 3.1 Time, Pace).
import type { Translate } from "../../../i18n/i18n.ts";
import { en, type MessageKey } from "../../../i18n/messages/en.ts";
import { type ActivityType, paceStyleFor } from "../../../../domain/activity.ts";
import { formatPace, formatSpeed, type PaceBand, type Units } from "../../../../domain/pace.ts";

/** Formatting locale per UI language: English uses day-month order and a 24-hour clock. */
const LOCALES: Readonly<Record<string, string>> = { en: "en-GB" };
const locale = (language: string) => LOCALES[language] ?? language;

export function formatDay(date: Date, zone: string, language: string): string {
  return new Intl.DateTimeFormat(locale(language), { dateStyle: "full", timeZone: zone }).format(
    date,
  );
}

export function formatTime(date: Date, zone: string, language: string): string {
  return new Intl.DateTimeFormat(locale(language), { timeStyle: "short", timeZone: zone }).format(
    date,
  );
}

export function formatDate(date: Date, zone: string, language: string): string {
  return new Intl.DateTimeFormat(locale(language), { dateStyle: "long", timeZone: zone }).format(
    date,
  );
}

export function formatKilometers(meters: number, language: string): string {
  return new Intl.NumberFormat(locale(language), { maximumFractionDigits: 1 }).format(
    meters / 1000,
  );
}

export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(locale(language)).format(value);
}

/** "5:30–6:00 min/km" for runs, "25–28 km/h" for rides (slower value first). */
export function formatPaceBand(
  band: PaceBand,
  activity: ActivityType,
  units: Units,
  t: Translate,
): string {
  if (paceStyleFor(activity) === "pace") {
    const [from, to] = [formatPace(band.fastest, units), formatPace(band.slowest, units)];
    return `${from === to ? from : `${from}–${to}`} ${t("unit.minPerKm")}`;
  }
  const [from, to] = [formatSpeed(band.slowest, units), formatSpeed(band.fastest, units)];
  return `${from === to ? from : `${from}–${to}`} ${t("unit.kmh")}`;
}

/** Message for a domain or form error code, with a generic fallback. */
export function fieldErrorMessage(code: string, t: Translate): string {
  const key = `field.${code}`;
  return isMessageKey(key) ? t(key) : t("field.invalid");
}

function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

/** 1..max days, plus a longer current value kept from before MAX_RETENTION_DAYS was lowered (spec 3.10). */
export function retentionOptions(maxRetentionDays: number, current: string): string[] {
  const options = Array.from({ length: maxRetentionDays }, (_, index) => String(index + 1));
  if (/^\d+$/.test(current) && Number(current) > maxRetentionDays) options.push(current);
  return options;
}
