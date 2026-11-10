// Posting rules (spec 7 Moderation): where the create form would be, how to get an invite link.
import type { Translate } from "../../../i18n/i18n.ts";

export function InviteNeeded({
  t,
  contactEmail,
  heading,
}: {
  t: Translate;
  /** The instance's contact, if configured. */
  contactEmail: string | undefined;
  /** The page's heading, or the section's when part of a page. */
  heading: { level: 1 | 2; text: string };
}) {
  const Heading = heading.level === 1 ? "h1" : "h2";
  return (
    <section class="invite-needed">
      <Heading>{heading.text}</Heading>
      <p>{t("posting.inviteNeeded")}</p>
      {contactEmail !== undefined && (
        <p>
          {t("posting.contact")} <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>
      )}
    </section>
  );
}
