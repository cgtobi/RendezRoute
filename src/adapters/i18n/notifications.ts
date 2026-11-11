// Notification texts in the recipient's stored language (spec 2 i18n, decisions P7, D17):
// the plan title as heading, one short sentence as body, and for emails and ntfy the plan's public
// time and place as lines (design note "Emails").
import type { Notification, NotificationFacts } from "../../domain/notification.ts";
import { formatDay, formatTime } from "./dates.ts";
import { negotiateLanguage, type Translate, translator } from "./i18n.ts";

export function notificationText(notification: Notification): { title: string; body: string } {
  const t = translator(negotiateLanguage(notification.language));
  return { title: notification.planTitle, body: t(`notify.${notification.kind}`) };
}

/** "Monday, 16 November 2026, 08:30 (Europe/Berlin time)" and the area, as on the plan page. */
export function factLines(
  facts: NotificationFacts | undefined,
  language: string,
  t: Translate,
): string[] {
  if (facts === undefined) return [];
  const start = new Date(facts.startsAt);
  return [
    `${formatDay(start, facts.timeZone, language)}, ${formatTime(start, facts.timeZone, language)} (${t("plan.timeZone", { zone: facts.timeZone })})`,
    facts.area,
  ];
}
