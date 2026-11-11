// Email delivery (spec 7 Optional notification channels, decision D31): notifications to confirmed
// addresses, the confirmation link, and report alerts to CONTACT_EMAIL. Every notification to a
// stored channel carries its link to turn the emails off.
import type { ChannelLinks, EmailOutbox, SendResult } from "../../../application/ports.ts";
import type { Notification } from "../../../domain/notification.ts";
import type { Mailer } from "./mailer.ts";
import {
  confirmationEmail,
  type EmailInstance,
  notificationEmail,
  reportAlertEmail,
} from "./messages.ts";

/** The page behind an email channel's link (confirm, refuse, or turn off). */
const linkUrl = (links: ChannelLinks, channelId: string, baseUrl: URL) =>
  new URL(`/e/${links.tokenFor(channelId)}`, baseUrl).href;

/** Sends one notification to an address the channel notifier found confirmed. */
export interface EmailDelivery {
  send(
    /** No channel once it went with its plan: the last email, with nothing left to turn off. */
    to: { address: string; channelId: string | undefined },
    notification: Notification,
  ): Promise<SendResult>;
}

export function createEmailDelivery({
  mailer,
  links,
  ...instance
}: EmailInstance & { mailer: Mailer; links: ChannelLinks }): EmailDelivery {
  return {
    send: (to, notification) =>
      mailer.send({
        to: to.address,
        ...notificationEmail(notification, {
          ...instance,
          offUrl:
            to.channelId === undefined ? undefined : linkUrl(links, to.channelId, instance.baseUrl),
        }),
      }),
  };
}

export function createEmailOutbox({
  mailer,
  links,
  contactEmail,
  ...instance
}: EmailInstance & {
  mailer: Mailer;
  links: ChannelLinks;
  contactEmail: string | undefined;
}): EmailOutbox {
  return {
    confirmation: (to, about) =>
      mailer.send({
        to: to.address,
        ...confirmationEmail(about, {
          ...instance,
          confirmUrl: linkUrl(links, to.channelId, instance.baseUrl),
        }),
      }),
    reportAlert: () =>
      contactEmail === undefined
        ? Promise.resolve("failed")
        : mailer.send({ to: contactEmail, ...reportAlertEmail(instance) }),
  };
}
