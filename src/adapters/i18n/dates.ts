// Dates and times in the plan's time zone and the reader's language (spec 3.1 Time), for pages
// and emails alike.
import { localeOf as locale } from "./i18n.ts";

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
