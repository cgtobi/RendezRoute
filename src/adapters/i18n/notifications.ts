// Notification texts in the recipient's stored language (spec 2 i18n, decisions P7, D17):
// the plan title as heading, one short sentence as body.
import type { Notification } from "../../domain/notification.ts";
import { negotiateLanguage, translator } from "./i18n.ts";

export function notificationText(notification: Notification): { title: string; body: string } {
  const t = translator(negotiateLanguage(notification.language));
  return { title: notification.planTitle, body: t(`notify.${notification.kind}`) };
}
