// Telegram messages (decision D34): notifications, the bot's answer to Start (notifications are
// on), and the account expiry warning, sent to the linked chat. Each message to a stored channel
// has a button to turn Telegram off, which opens the channel's link page; notifications also have
// one that opens the plan.
import type { ChannelLinks, SendResult, TelegramOutbox } from "../../../application/ports.ts";
import type { Notification } from "../../../domain/notification.ts";
import { formatDate } from "../../i18n/dates.ts";
import { negotiateLanguage, translator } from "../../i18n/i18n.ts";
import { factLines } from "../../i18n/notifications.ts";
import type { MessageInstance } from "../instance.ts";
import type { TelegramButton, TelegramClient } from "./client.ts";

/** Sends one notification to a chat the channel notifier found linked and confirmed. */
export interface TelegramDelivery {
  send(
    /** No channel once it went with its plan: the last message, with nothing left to turn off. */
    to: { chatId: string; channelId: string | undefined },
    notification: Notification,
  ): Promise<SendResult>;
}

export function createTelegram({
  client,
  links,
  timeZone,
  ...instance
}: MessageInstance & {
  client: TelegramClient;
  links: ChannelLinks;
  /** Dates that belong to no plan, such as an account's deletion: DEFAULT_TIMEZONE. */
  timeZone: string;
}): { outbox: TelegramOutbox; delivery: TelegramDelivery } {
  const turnOff = (label: string, channelId: string): TelegramButton => ({
    text: label,
    url: new URL(`/e/${links.tokenFor(channelId)}`, instance.baseUrl).href,
  });

  return {
    delivery: {
      send(to, notification) {
        const language = negotiateLanguage(notification.language);
        const t = translator(language);
        return client.send({
          chatId: to.chatId,
          text: [
            notification.planTitle,
            t(`notify.${notification.kind}`),
            ...factLines(notification.facts, language, t),
          ].join("\n"),
          buttons: [
            ...(notification.planPath === undefined
              ? []
              : [
                  {
                    text: t("email.openPlan"),
                    url: new URL(notification.planPath, instance.baseUrl).href,
                  },
                ]),
            ...(to.channelId === undefined ? [] : [turnOff(t("telegram.turnOff"), to.channelId)]),
          ],
        });
      },
    },
    outbox: {
      confirmation(to, about) {
        const t = translator(negotiateLanguage(to.language));
        return client.send({
          chatId: to.chatId,
          text:
            about.kind === "plan"
              ? t("telegram.on", { title: about.planTitle })
              : t("telegram.accountOn", { instance: instance.instanceName }),
          buttons: [turnOff(t("telegram.turnOff"), to.channelId)],
        });
      },
      accountExpiry(to, deleteAt) {
        const language = negotiateLanguage(to.language);
        const t = translator(language);
        const date = formatDate(deleteAt, timeZone, language);
        return client.send({
          chatId: to.chatId,
          text: [
            t("notice.expirySubject", { instance: instance.instanceName, date }),
            t("notice.expiryBody", { date }),
          ].join("\n"),
          buttons: [
            { text: t("email.openAccount"), url: new URL("/account", instance.baseUrl).href },
            turnOff(t("telegram.turnOff"), to.channelId),
          ],
        });
      },
    },
  };
}
