// Posting rules (spec 7 Moderation): where the create form would be, how to become allowed to post.
import type { PostingNeed } from "../../../../application/posting-rules.ts";
import type { Translate } from "../../../i18n/i18n.ts";

export function PostingClosed({
  t,
  requirement,
  contactEmail,
  heading,
}: {
  t: Translate;
  /** An invite link, or a login (POSTING_MODE=invite or logged_in). */
  requirement: PostingNeed;
  /** The instance's contact, if configured. */
  contactEmail: string | undefined;
  /** The page's heading, or the section's when part of a page. */
  heading: { level: 1 | 2; text: string };
}) {
  const Heading = heading.level === 1 ? "h1" : "h2";
  return (
    <section class="invite-needed">
      <Heading>{heading.text}</Heading>
      {requirement === "invite" ? (
        <>
          <p>{t("posting.inviteNeeded")}</p>
          {contactEmail !== undefined && (
            <p>
              {t("posting.contact")} <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </p>
          )}
        </>
      ) : (
        <>
          <p>{t("posting.loginNeeded")}</p>
          <p>
            <a class="button" href="/account">
              {t("posting.login")}
            </a>
          </p>
        </>
      )}
    </section>
  );
}
