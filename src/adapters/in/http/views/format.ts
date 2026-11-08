// Display formatting for the plan's time zone and units (spec 3.1 Time, Pace).
import type { OwnResponseView } from "../../../../application/plan-views.ts";
import { localeOf as locale, type Translate } from "../../../i18n/i18n.ts";
import { en, type MessageKey } from "../../../i18n/messages/en.ts";
import { type ActivityType, paceStyleFor } from "../../../../domain/activity.ts";
import { formatPace, formatSpeed, type PaceBand } from "../../../../domain/pace.ts";
import {
  celsiusToTemperature,
  kmhToSpeed,
  metersToDistance,
  metersToElevation,
  type Units,
} from "../../../../domain/units.ts";

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

/** "12.5 km" or "7.8 mi" (decision P5). */
export function formatDistance(
  meters: number,
  units: Units,
  language: string,
  t: Translate,
): string {
  const value = new Intl.NumberFormat(locale(language), { maximumFractionDigits: 1 }).format(
    metersToDistance(meters, units),
  );
  return `${value} ${t(units === "imperial" ? "unit.mi" : "unit.km")}`;
}

/** "350 m" or "1,148 ft". */
export function formatElevation(
  meters: number,
  units: Units,
  language: string,
  t: Translate,
): string {
  const value = formatNumber(Math.round(metersToElevation(meters, units)), language);
  return `${value} ${t(units === "imperial" ? "unit.ft" : "unit.m")}`;
}

/** "14 °C" or "58 °F", whole degrees. */
export function formatTemperature(
  celsius: number,
  units: Units,
  language: string,
  t: Translate,
): string {
  const value = formatNumber(Math.round(celsiusToTemperature(celsius, units)), language);
  return `${value} ${t(units === "imperial" ? "unit.fahrenheit" : "unit.celsius")}`;
}

/** "12 km/h" or "7 mph". */
export function formatWindSpeed(kmh: number, units: Units, language: string, t: Translate): string {
  const value = formatNumber(Math.round(kmhToSpeed(kmh, units)), language);
  return `${value} ${t(units === "imperial" ? "unit.mph" : "unit.kmh")}`;
}

/** "20%", "20 %" in German and French. */
export function formatPercent(percent: number, language: string): string {
  return new Intl.NumberFormat(locale(language), { style: "percent" }).format(percent / 100);
}

export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(locale(language)).format(value);
}

/** A plain decimal like "12.5" written the language's way ("12,5"); the forms accept both. */
export function localizeDecimal(value: string, language: string): string {
  const separator =
    new Intl.NumberFormat(locale(language))
      .formatToParts(1.5)
      .find((part) => part.type === "decimal")?.value ?? ".";
  return value.replace(".", separator);
}

/** "5:30–6:00 min/km" for runs, "25–28 km/h" for rides (slower value first); per mile or mph in imperial. */
export function formatPaceBand(
  band: PaceBand,
  activity: ActivityType,
  units: Units,
  t: Translate,
): string {
  if (paceStyleFor(activity) === "pace") {
    const [from, to] = [formatPace(band.fastest, units), formatPace(band.slowest, units)];
    return `${from === to ? from : `${from}–${to}`} ${t(units === "imperial" ? "unit.minPerMi" : "unit.minPerKm")}`;
  }
  const [from, to] = [formatSpeed(band.slowest, units), formatSpeed(band.fastest, units)];
  return `${from === to ? from : `${from}–${to}`} ${t(units === "imperial" ? "unit.mph" : "unit.kmh")}`;
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

/** The status text of one's own response; an undecided request after the start is "not answered" (spec 3.1). */
export function statusKey(response: OwnResponseView): MessageKey {
  return response.notAnswered ? "status.notAnswered" : `status.${response.kind}`;
}
