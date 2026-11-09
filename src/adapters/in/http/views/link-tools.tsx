// "Get a new link" and "Sign out all other devices" (spec 3.2, decision I44), on the host, manage
// and template pages, and the page that shows a new link once.
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";

export function LinkTools({
  t,
  base,
  csrfToken,
  signedOut,
  notifications,
  nonce,
}: {
  t: Translate;
  /** The page's path; the actions are `<base>/link` and `<base>/sign-out`. */
  base: string;
  csrfToken: string;
  /** How many other devices the last sign-out removed, shown once after it. */
  signedOut: number | undefined;
  /** Whether signing out also turns notifications off, and this device can turn them on again. */
  notifications: boolean;
  /** One-time value, so a resent form issues no second link (decision I44). */
  nonce: string;
}) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  return (
    <section class="link-tools">
      <h2>{t("linkTools.heading")}</h2>
      {signedOut !== undefined && (
        <p class="notice" role="status">
          {t("linkTools.signedOut", { count: signedOut })}
        </p>
      )}
      <p>{t("linkTools.explain")}</p>
      <form method="post" action={`${base}/link`}>
        {csrf}
        <input type="hidden" name="nonce" value={nonce} />
        <button type="submit" class="secondary">
          {t("linkTools.newLink")}
        </button>
      </form>
      <details>
        <summary>{t("linkTools.signOut")}</summary>
        <p>{t("linkTools.signOutExplain")}</p>
        {notifications && <p>{t("linkTools.signOutNotifications")}</p>}
        <form method="post" action={`${base}/sign-out`}>
          {csrf}
          <button type="submit" class="danger">
            {t("linkTools.signOutConfirm")}
          </button>
        </form>
      </details>
    </section>
  );
}

/** A resent "Get a new link" form: nothing changed, the link shown before still works. */
export function AlreadyIssuedPage({ t, backPath }: { t: Translate; backPath: string }) {
  return (
    <section class="links">
      <h1>{t("linkTools.newHeading")}</h1>
      <p class="notice">{t("linkTools.alreadyIssued")}</p>
      <p>
        <a class="button" href={backPath}>
          {t("linkTools.back")}
        </a>
      </p>
    </section>
  );
}

/** Shown once after "Get a new link": only the hash is stored (spec 3.2). */
export function NewLinkPage({
  t,
  label,
  url,
  warning,
  backPath,
}: {
  t: Translate;
  label: string;
  url: string;
  warning: string;
  backPath: string;
}) {
  return (
    <section class="links">
      <h1>{t("linkTools.newHeading")}</h1>
      <p>{t("linkTools.oldLinkStopped")}</p>
      <h2>{label}</h2>
      <p class="link-box">
        <code>{url}</code>
      </p>
      <p class="warning">{warning}</p>
      <p>
        <a class="button" href={backPath}>
          {t("linkTools.back")}
        </a>
      </p>
    </section>
  );
}
