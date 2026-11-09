// Confirmation step for host and manage links (decision D1).
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";

/** Generic tags, so a pasted secret link previews as a warning rather than the plan. */
export function SecretLinkHead({ t }: { t: Translate }) {
  return (
    <>
      <meta name="robots" content="noindex" />
      <meta property="og:title" content={t("hostLink.ogTitle")} />
      <meta property="og:description" content={t("hostLink.ogDescription")} />
    </>
  );
}

export function SecretLinkConfirm(props: {
  t: Translate;
  heading: string;
  body: string;
  warning: string;
  action: "/a" | "/m" | "/t";
  token: string;
  csrfToken: string;
}) {
  return (
    <section>
      <h1>{props.heading}</h1>
      <p>{props.body}</p>
      <p class="warning">{props.warning}</p>
      <form method="post" action={props.action}>
        <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
        <input type="hidden" name="token" value={props.token} />
        <button type="submit">{props.t("secretLink.confirm")}</button>
      </form>
    </section>
  );
}
