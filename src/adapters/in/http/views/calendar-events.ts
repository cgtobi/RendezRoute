// Calendar entries as iCalendar events (spec 6 feature 2, decision I40), in the reader's language.
import type { CalendarEntry } from "../../../../application/calendar.ts";
import { instantToLocal } from "../../../../domain/timezone.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import type { IcsEvent } from "../ics.ts";
import { formatDate } from "./format.ts";

export function calendarEvents(
  entries: readonly CalendarEntry[],
  options: {
    t: Translate;
    language: string;
    baseUrl: URL;
    /** Feeds add an all-day entry on each deletion date (spec 3.10). */
    deletionEntries: boolean;
  },
): IcsEvent[] {
  return entries.flatMap((entry) => {
    const events = [planEvent(entry, options)];
    if (options.deletionEntries) events.push(deletionEvent(entry, options));
    return events;
  });
}

type Options = Parameters<typeof calendarEvents>[1];

const planUrl = (entry: CalendarEntry, baseUrl: URL) => new URL(`/p/${entry.planId}`, baseUrl).href;

const deletionText = (entry: CalendarEntry, { t, language }: Options) =>
  t("plan.deletion", { date: formatDate(entry.deleteAt, entry.timeZone, language) });

function planEvent(entry: CalendarEntry, options: Options): IcsEvent {
  const { t, baseUrl } = options;
  const named = entry.hosting ? t("calendar.yourPlan", { title: entry.title }) : entry.title;
  const { exactStart } = entry;
  const point = exactStart?.point;
  const startLines =
    exactStart === undefined
      ? []
      : [
          t("calendar.exactStart", {
            start: [exactStart.description, point && `${point.lat}, ${point.lng}`]
              .filter(Boolean)
              .join(" · "),
          }),
        ];
  const cancelled = entry.status === "cancelled";
  return {
    uid: `${entry.planId}@${baseUrl.host}`,
    start: entry.startsAt,
    end: entry.endsAt,
    summary: cancelled ? t("calendar.cancelled", { title: named }) : named,
    location: exactStart?.description ?? entry.areaLabel,
    description: [...startLines, deletionText(entry, options), planUrl(entry, baseUrl)].join("\n"),
    url: planUrl(entry, baseUrl),
    status: cancelled ? "CANCELLED" : "CONFIRMED",
    geo: point,
  };
}

/** An all-day entry on the deletion date in the plan's zone. */
function deletionEvent(entry: CalendarEntry, options: Options): IcsEvent {
  const { date } = instantToLocal(entry.deleteAt, entry.timeZone);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return {
    uid: `${entry.planId}-deletion@${options.baseUrl.host}`,
    start: { date },
    end: { date: next },
    summary: options.t("calendar.deletionEntry", { title: entry.title }),
    description: [deletionText(entry, options), planUrl(entry, options.baseUrl)].join("\n"),
    url: planUrl(entry, options.baseUrl),
    transparent: true,
  };
}
