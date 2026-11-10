// The calendar subscription page (spec 6 feature 2, decision D18): the feed link is shown once,
// in the response to creating it, like other secret links (spec 3.2). No dates: the server does
// not know the browser's time zone.
import { DEVICE_UNUSED_DAYS } from "../../../../domain/expiry.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { BackLink } from "./back-link.tsx";

export function CalendarPage(props: {
  t: Translate;
  csrfToken: string;
  /** This browser has a feed. */
  hasFeed: boolean;
  /** This browser has plans for a feed (spec 3.10: feeds that reference nothing are deleted). */
  canCreate: boolean;
  /** Only in the response that created the link. */
  link?: { https: string; webcal: string } | undefined;
}) {
  const { t, link, hasFeed, canCreate } = props;
  const csrf = <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />;
  // The link, when just made, and managing the feed: each its own part (decision D27).
  return (
    <section class="calendar sectioned">
      {/* Managed from "My data", which links here (decision D27). */}
      <BackLink href="/my-data" label={t("myData.back")} />
      <h1>{t("calendar.title")}</h1>
      <p>{t("calendar.intro")}</p>
      <p class="hint">{t("calendar.contents")}</p>

      {link !== undefined && (
        <section>
          <h2>{t("calendar.linkHeading")}</h2>
          <p>
            <a class="button" href={link.webcal}>
              {t("calendar.subscribe")}
            </a>
          </p>
          <p>{t("calendar.copy")}</p>
          <p class="link-box">
            <code>{link.https}</code>
          </p>
          <p class="warning">{t("calendar.linkWarning")}</p>
        </section>
      )}
      <section>
        {link === undefined && hasFeed && <p>{t("calendar.active")}</p>}
        {hasFeed && <p>{t("calendar.expiry", { days: DEVICE_UNUSED_DAYS })}</p>}
        {canCreate ? (
          <form method="post" action="/calendar">
            {csrf}
            <button type="submit" class={hasFeed ? "secondary" : undefined}>
              {hasFeed ? t("calendar.renew") : t("calendar.create")}
            </button>
          </form>
        ) : (
          <p class="notice">{t("calendar.nothingYet")}</p>
        )}
        {hasFeed && (
          <>
            {canCreate && <p class="hint">{t("calendar.renewHint")}</p>}
            <form method="post" action="/calendar/stop">
              {csrf}
              <button type="submit" class="secondary">
                {t("calendar.stop")}
              </button>
            </form>
          </>
        )}
      </section>
    </section>
  );
}
