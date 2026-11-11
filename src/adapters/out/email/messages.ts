// What the emails say and how they look (design note "Emails (step 6)", decision D31): a
// plain-text part and a simple HTML part in the page's light colours, written inline since mail
// apps drop style sheets. The instance name at the top, the plan title as the heading, one main
// link styled as the primary button, every link also written out, and a muted footer saying why
// the email came and how to turn it off. No images and nothing loaded from other servers.
import type { Notification, NotificationFacts } from "../../../domain/notification.ts";
import { formatDay, formatTime } from "../../i18n/dates.ts";
import { negotiateLanguage, type Translate, translator } from "../../i18n/i18n.ts";

/** The light tokens of public/app.css (decision D27). */
const COLOURS = {
  bg: "#ffffff",
  fg: "#16181d",
  muted: "#5c636e",
  line: "#e4e7eb",
  accent: "#2c67a8",
  onAccent: "#ffffff",
} as const;

export interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/** The instance as its emails name and link it. */
export interface EmailInstance {
  instanceName: string;
  baseUrl: URL;
}

/** Marks a message as sent by a program, so mail apps send no out-of-office replies (RFC 3834). */
const AUTOMATIC = { "Auto-Submitted": "auto-generated" };

/** The link that turns the emails off: in the footer, and for one click in the mail app (RFC 8058). */
const offHeaders = (url: string) => ({
  "List-Unsubscribe": `<${url}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  ...AUTOMATIC,
});

/** "Monday, 16 November 2026, 08:30 (Europe/Berlin time)" and the area, as on the plan page. */
function factLines(facts: NotificationFacts | undefined, language: string, t: Translate): string[] {
  if (facts === undefined) return [];
  const start = new Date(facts.startsAt);
  return [
    `${formatDay(start, facts.timeZone, language)}, ${formatTime(start, facts.timeZone, language)} (${t("plan.timeZone", { zone: facts.timeZone })})`,
    facts.area,
  ];
}

/**
 * `offUrl` is the channel's link; undefined once the channel is gone with its plan, when this is
 * the last email about it and there is nothing left to turn off.
 */
export function notificationEmail(
  notification: Notification,
  instance: EmailInstance & { offUrl: string | undefined },
): ComposedEmail {
  const language = negotiateLanguage(notification.language);
  const t = translator(language);
  const sentence = t(`notify.${notification.kind}`);
  const { offUrl } = instance;
  return {
    subject: `${notification.planTitle}: ${sentence}`,
    ...compose({
      language,
      instanceName: instance.instanceName,
      heading: notification.planTitle,
      body: [sentence],
      facts: factLines(notification.facts, language, t),
      action:
        notification.planPath === undefined
          ? undefined
          : {
              label: t("email.openPlan"),
              url: new URL(notification.planPath, instance.baseUrl).href,
            },
      footer:
        offUrl === undefined
          ? t("email.lastWhy")
          : t("email.why", { title: notification.planTitle, instance: instance.instanceName }),
      footerLink: offUrl === undefined ? undefined : { label: t("email.turnOff"), url: offUrl },
    }),
    headers: offUrl === undefined ? AUTOMATIC : offHeaders(offUrl),
  };
}

/** The only email sent to an address before it is confirmed (decision D31). */
export function confirmationEmail(
  about: { planTitle: string; language: string },
  instance: EmailInstance & { confirmUrl: string },
): ComposedEmail {
  const language = negotiateLanguage(about.language);
  const t = translator(language);
  return {
    subject: t("email.confirmSubject", { title: about.planTitle }),
    ...compose({
      language,
      instanceName: instance.instanceName,
      heading: about.planTitle,
      body: [t("email.confirmBody")],
      facts: [],
      action: { label: t("email.confirmAction"), url: instance.confirmUrl },
      footer: t("email.confirmWhy", { instance: instance.instanceName }),
      // Whoever got it without asking can refuse it too: the link's page offers both.
      footerLink: { label: t("email.refuse"), url: instance.confirmUrl },
    }),
    headers: offHeaders(instance.confirmUrl),
  };
}

/** To CONTACT_EMAIL for each new report, without anything of it (spec 7 Moderation). */
export function reportAlertEmail(instance: EmailInstance): ComposedEmail {
  const language = negotiateLanguage(undefined);
  const t = translator(language);
  const heading = t("email.reportSubject", { instance: instance.instanceName });
  return {
    subject: heading,
    ...compose({
      language,
      instanceName: instance.instanceName,
      heading,
      body: [t("email.reportBody")],
      facts: [],
      action: { label: t("email.reportAction"), url: new URL("/admin/", instance.baseUrl).href },
      footer: t("email.reportWhy", { instance: instance.instanceName }),
      footerLink: undefined,
    }),
    headers: AUTOMATIC,
  };
}

interface Link {
  label: string;
  url: string;
}

function compose(parts: {
  language: string;
  instanceName: string;
  heading: string;
  body: readonly string[];
  /** When and where, one line each. */
  facts: readonly string[];
  action: Link | undefined;
  footer: string;
  footerLink: Link | undefined;
}): { text: string; html: string } {
  const { action, footerLink } = parts;
  const text = [
    parts.instanceName,
    "",
    parts.heading,
    "",
    ...parts.body,
    ...(parts.facts.length === 0 ? [] : ["", ...parts.facts]),
    ...(action === undefined ? [] : ["", `${action.label}: ${action.url}`]),
    "",
    "--",
    parts.footer,
    ...(footerLink === undefined ? [] : [`${footerLink.label}: ${footerLink.url}`]),
    "",
  ].join("\n");

  const font = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const writtenOut = (link: Link) =>
    `<a href="${escape(link.url)}" style="color:${COLOURS.accent}">${escape(link.url)}</a>`;
  const html = [
    "<!doctype html>",
    `<html lang="${escape(parts.language)}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>',
    `<body style="margin:0;padding:24px 16px;background:${COLOURS.bg};color:${COLOURS.fg};${font};font-size:16px;line-height:1.5">`,
    '<div style="max-width:560px;margin:0 auto">',
    `<p style="margin:0 0 24px;color:${COLOURS.accent};font-weight:700">${escape(parts.instanceName)}</p>`,
    `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">${escape(parts.heading)}</h1>`,
    ...parts.body.map((line) => `<p style="margin:0 0 16px">${escape(line)}</p>`),
    ...parts.facts.map((line) => `<p style="margin:0 0 4px;font-weight:700">${escape(line)}</p>`),
    ...(action === undefined
      ? []
      : [
          `<p style="margin:24px 0 8px"><a href="${escape(action.url)}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:${COLOURS.accent};color:${COLOURS.onAccent};font-weight:700;text-decoration:none">${escape(action.label)}</a></p>`,
          `<p style="margin:0 0 24px;font-size:14px;word-break:break-all">${writtenOut(action)}</p>`,
        ]),
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid ${COLOURS.line};color:${COLOURS.muted};font-size:14px">`,
    `<p style="margin:0 0 8px">${escape(parts.footer)}</p>`,
    ...(footerLink === undefined
      ? []
      : [
          `<p style="margin:0;word-break:break-all">${escape(footerLink.label)}: ${writtenOut(footerLink)}</p>`,
        ]),
    "</div>",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
  return { text, html };
}

const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
