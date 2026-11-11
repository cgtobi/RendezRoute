// ntfy messages (decision D33): notifications, the confirmation link and the account expiry
// warning, posted to the channel's secret topic. Tapping a notification opens the plan; every
// message to a stored channel has a button to turn ntfy off, which opens the channel's link page.
import type {
  ChannelLinks,
  ChannelSubject,
  NtfyOutbox,
  SendResult,
} from "../../../application/ports.ts";
import type { Notification } from "../../../domain/notification.ts";
import { formatDate } from "../../i18n/dates.ts";
import { negotiateLanguage, translator } from "../../i18n/i18n.ts";
import { factLines } from "../../i18n/notifications.ts";
import type { MessageInstance } from "../instance.ts";
import type { NtfyAction, NtfyClient } from "./client.ts";

/** Sends one notification to a topic the channel notifier found confirmed. */
export interface NtfyDelivery {
  send(
    /** No channel once it went with its plan: the last message, with nothing left to turn off. */
    to: { topic: string; server: string; channelId: string | undefined },
    notification: Notification,
  ): Promise<SendResult>;
}

export function createNtfy({
  client,
  server,
  links,
  timeZone,
  ...instance
}: MessageInstance & {
  client: NtfyClient;
  /** NTFY_URL, where the client posts: a topic made on another server gets nothing. */
  server: URL;
  links: ChannelLinks;
  /** Dates that belong to no plan, such as an account's deletion: DEFAULT_TIMEZONE. */
  timeZone: string;
}): { outbox: NtfyOutbox; delivery: NtfyDelivery } {
  const linkUrl = (channelId: string) =>
    new URL(`/e/${links.tokenFor(channelId)}`, instance.baseUrl).href;
  const turnOff = (label: string, channelId: string): NtfyAction => ({
    action: "view",
    label,
    url: linkUrl(channelId),
    clear: true,
  });

  return {
    delivery: {
      send(to, notification) {
        if (to.server !== server.href) return Promise.resolve("failed");
        const t = translator(negotiateLanguage(notification.language));
        const language = negotiateLanguage(notification.language);
        return client.publish({
          topic: to.topic,
          title: notification.planTitle,
          message: [
            t(`notify.${notification.kind}`),
            ...factLines(notification.facts, language, t),
          ].join("\n"),
          click:
            notification.planPath === undefined
              ? undefined
              : new URL(notification.planPath, instance.baseUrl).href,
          actions:
            to.channelId === undefined ? undefined : [turnOff(t("ntfy.turnOff"), to.channelId)],
        });
      },
    },
    outbox: {
      confirmation(to, about: ChannelSubject) {
        const t = translator(negotiateLanguage(to.language));
        const confirmUrl = linkUrl(to.channelId);
        return client.publish({
          topic: to.topic,
          title: t("ntfy.confirmTitle", { instance: instance.instanceName }),
          message:
            about.kind === "plan"
              ? t("ntfy.confirmBody", { title: about.planTitle })
              : t("ntfy.accountConfirmBody", { instance: instance.instanceName }),
          click: confirmUrl,
          actions: [{ action: "view", label: t("ntfy.confirm"), url: confirmUrl, clear: true }],
        });
      },
      accountExpiry(to, deleteAt) {
        const language = negotiateLanguage(to.language);
        const t = translator(language);
        const date = formatDate(deleteAt, timeZone, language);
        return client.publish({
          topic: to.topic,
          title: t("notice.expirySubject", { instance: instance.instanceName, date }),
          message: t("notice.expiryBody", { date }),
          click: new URL("/account", instance.baseUrl).href,
          actions: [turnOff(t("ntfy.turnOff"), to.channelId)],
        });
      },
    },
  };
}
