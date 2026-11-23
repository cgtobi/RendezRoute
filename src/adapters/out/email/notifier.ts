// Email delivery (spec 7 Optional notification channels, decisions D31, I55): notifications to
// confirmed addresses, the confirmation link, report alerts to CONTACT_EMAIL, the account expiry
// warning and "Email me my links". Every email to a stored channel carries its link to turn the
// emails off.
import type { ChannelLinks, EmailOutbox, SendResult } from "../../../application/ports.ts";
import type { Notification } from "../../../domain/notification.ts";
import type { Mailer } from "./mailer.ts";
import {
  accountExpiryEmail,
  confirmationEmail,
  newLinkEmail,
  notificationEmail,
  reportAlertEmail,
} from "./messages.ts";
import type { MessageInstance } from "../instance.ts";

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
}: MessageInstance & { mailer: Mailer; links: ChannelLinks }): EmailDelivery {
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
  timeZone,
  adminUrl,
  ...instance
}: MessageInstance & {
  mailer: Mailer;
  links: ChannelLinks;
  contactEmail: string | undefined;
  /** The origin of the admin pages for the report alert; undefined: no link (decision D55). */
  adminUrl: URL | undefined;
  /** Dates that belong to no plan, such as an account's deletion: DEFAULT_TIMEZONE. */
  timeZone: string;
}): EmailOutbox {
  const urlOf = (channelId: string) => linkUrl(links, channelId, instance.baseUrl);
  return {
    confirmation: (to, about) =>
      mailer.send({
        to: to.address,
        ...confirmationEmail(
          { ...about, language: to.language },
          { ...instance, confirmUrl: urlOf(to.channelId) },
        ),
      }),
    reportAlert: (openReports) =>
      contactEmail === undefined
        ? Promise.resolve("failed")
        : mailer.send({
            to: contactEmail,
            ...reportAlertEmail(instance, adminUrl, undefined, openReports),
          }),
    accountExpiry: (to, deleteAt) =>
      mailer.send({
        to: to.address,
        ...accountExpiryEmail(to, deleteAt, { ...instance, timeZone, offUrl: urlOf(to.channelId) }),
      }),
    newLink: (to, link) =>
      mailer.send({
        to: to.address,
        ...newLinkEmail(to, link, { ...instance, offUrl: urlOf(to.channelId) }),
      }),
  };
}

/** Both parts of email over one mailer: notifications to channels, and the other emails. */
export function createEmail(
  settings: MessageInstance & {
    mailer: Mailer;
    links: ChannelLinks;
    contactEmail: string | undefined;
    timeZone: string;
    adminUrl: URL | undefined;
  },
): { outbox: EmailOutbox; delivery: EmailDelivery } {
  return { outbox: createEmailOutbox(settings), delivery: createEmailDelivery(settings) };
}
