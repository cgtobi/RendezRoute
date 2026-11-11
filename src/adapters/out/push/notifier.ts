// Web Push delivery (spec 6 feature 3, decision I36): the message is encrypted for the browser,
// identified with the instance's VAPID key and posted only to a browser vendor's push service.
import type { ChannelRepository, Notifier, OutboundHttp } from "../../../application/ports.ts";
import type { Notification } from "../../../domain/notification.ts";
import { notificationText } from "../../i18n/notifications.ts";
import { encryptPayload } from "./encryption.ts";
import { type VapidKeys, vapidAuthorization } from "./vapid.ts";

/** How long a push service keeps an undelivered message (seconds). */
const TTL_SECONDS = 24 * 60 * 60;

export function createWebPushNotifier({
  channels,
  http,
  vapid,
  subject,
  baseUrl,
  now,
}: {
  channels: ChannelRepository;
  /** Restricted to the push services' hosts. */
  http: OutboundHttp;
  vapid: VapidKeys;
  subject: string;
  baseUrl: URL;
  now: () => Date;
}): Notifier {
  return {
    async send(to, notification: Notification) {
      // Addresses are the email delivery's (decision D31).
      if ("email" in to) return "failed";
      const channel = "channelId" in to ? await channels.findById(to.channelId) : undefined;
      const subscription =
        "subscription" in to
          ? to.subscription
          : channel?.kind === "webpush"
            ? channel.subscription
            : undefined;
      if (subscription === undefined) return "gone";
      const { title, body } = notificationText(notification);
      const message = {
        title,
        body,
        ...(notification.planPath === undefined
          ? {}
          : { url: new URL(notification.planPath, baseUrl).href }),
      };
      let encrypted: Uint8Array;
      try {
        encrypted = encryptPayload(
          new TextEncoder().encode(JSON.stringify(message)),
          subscription.keys,
        );
      } catch {
        // The browser's key is not a usable P-256 point: no message can ever reach it.
        return "gone";
      }
      const endpoint = new URL(subscription.endpoint);
      const response = await http.post(endpoint, {
        headers: {
          authorization: vapidAuthorization({ endpoint, keys: vapid, subject, now: now() }),
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(TTL_SECONDS),
          urgency: "normal",
        },
        body: encrypted,
        maxBytes: 64 * 1024,
      });
      if (response.status >= 200 && response.status < 300) return "sent";
      if (response.status === 429 || response.status >= 500) return "retry";
      // Any other refusal (expired, unknown, another VAPID key, malformed) will not change on a
      // retry; deleting the channel keeps made-up subscriptions from being sent to again.
      return "gone";
    },
  };
}
