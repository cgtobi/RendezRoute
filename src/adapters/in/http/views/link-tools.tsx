// "Get a new link", "Email me my links" and "Sign out all other devices" (spec 3.2, decisions I44,
// D31), on the host, manage and template pages, and the page that shows a new link once.
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";

/** The field that sends both actions back to "My data" instead of the item's page (I45). */
export const FROM_MY_DATA = { name: "from", value: "my-data" } as const;

/** "Email me my links" (decision D31): where the new link would go, and how the last try went. */
export interface LinkEmail {
  /** The item's confirmed address; without one there is no button. */
  address: string | undefined;
  outcome: "sent" | "failed" | undefined;
}

export function LinkTools({
  t,
  base,
  csrfToken,
  signedOut,
  notifications,
  nonce,
  compact = false,
  returnToMyData = false,
  email,
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
  /** Folded into one line, for lists. */
  compact?: boolean;
  /** Both actions come back to "My data" instead of the item's page (decision I45). */
  returnToMyData?: boolean;
  /** "Email me my links", on the item's own page. */
  email?: LinkEmail | undefined;
}) {
  const hidden = (
    <>
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      {returnToMyData && (
        <input type="hidden" name={FROM_MY_DATA.name} value={FROM_MY_DATA.value} />
      )}
    </>
  );
  const forms = (
    <>
      <form method="post" action={`${base}/link`}>
        {hidden}
        <input type="hidden" name="nonce" value={nonce} />
        <button type="submit" class="secondary">
          {t("linkTools.newLink")}
        </button>
      </form>
      {email?.address !== undefined && (
        <form method="post" action={`${base}/link/email`}>
          {hidden}
          <input type="hidden" name="nonce" value={nonce} />
          <p class="hint">{t("linkTools.emailLinkHint", { address: email.address })}</p>
          <button type="submit" class="secondary">
            {t("linkTools.emailLink")}
          </button>
        </form>
      )}
      <details>
        <summary>{t("linkTools.signOut")}</summary>
        <p>{t("linkTools.signOutExplain")}</p>
        {notifications && <p>{t("linkTools.signOutNotifications")}</p>}
        <form method="post" action={`${base}/sign-out`}>
          {hidden}
          <button type="submit" class="danger">
            {t("linkTools.signOutConfirm")}
          </button>
        </form>
      </details>
    </>
  );
  if (compact) {
    return (
      <details class="link-tools">
        <summary>{t("linkTools.heading")}</summary>
        {forms}
      </details>
    );
  }
  return (
    <section class="link-tools">
      <h2>{t("linkTools.heading")}</h2>
      {signedOut !== undefined && (
        <p class="notice" role="status">
          {t("linkTools.signedOut", { count: signedOut })}
        </p>
      )}
      {email?.outcome === "sent" && email.address !== undefined && (
        <p class="notice" role="status">
          {t("linkTools.emailed", { address: email.address })}
        </p>
      )}
      {email?.outcome === "failed" && (
        <p class="warning" role="alert">
          {t("linkTools.emailFailed")}
        </p>
      )}
      <p>{t("linkTools.explain")}</p>
      {forms}
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
