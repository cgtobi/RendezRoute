// Text of link previews, shared by the Open Graph tags and the card image (spec 3.3). Built only
// from the public PlanPreview, in the plan's language, so every requester gets the same preview.
import type { PlanPreview } from "../../../../application/plan-views.ts";
import { negotiateLanguage, type Translate, translator } from "../../../i18n/i18n.ts";
import { formatDay, formatKilometers, formatPaceBand, formatTime } from "./format.ts";

export interface PreviewText {
  language: string;
  /** "Cancelled: …" for cancelled plans. */
  title: string;
  activity: string;
  when: string;
  area: string;
  /** Distance and pace or speed, when given. */
  details: string[];
  t: Translate;
}

export function previewText(preview: PlanPreview): PreviewText {
  const language = negotiateLanguage(preview.language);
  const t = translator(language);
  const details: string[] = [];
  if (preview.distanceMeters !== undefined) {
    details.push(`${formatKilometers(preview.distanceMeters, language)} ${t("unit.km")}`);
  }
  if (preview.pace !== undefined) {
    details.push(formatPaceBand(preview.pace, preview.activity, "metric", t));
  }
  return {
    language,
    title:
      preview.status === "cancelled"
        ? t("preview.cancelled", { title: preview.title })
        : preview.title,
    activity: t(`activity.${preview.activity}`),
    when: `${formatDay(preview.startsAt, preview.timeZone, language)}, ${formatTime(preview.startsAt, preview.timeZone, language)} (${t("plan.timeZone", { zone: preview.timeZone })})`,
    area: preview.areaLabel,
    details,
    t,
  };
}

/** One line for og:description. */
export const previewDescription = (text: PreviewText) =>
  [text.activity, text.when, text.area, ...text.details].join(" · ");
