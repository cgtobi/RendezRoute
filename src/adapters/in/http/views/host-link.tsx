// Confirmation step for host links (decision D1).
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";

export function HostLinkHead({ t }: { t: Translate }) {
  return (
    <>
      <meta name="robots" content="noindex" />
      <meta property="og:title" content={t("hostLink.ogTitle")} />
      <meta property="og:description" content={t("hostLink.ogDescription")} />
    </>
  );
}

export function HostLinkConfirm(props: {
  t: Translate;
  title: string;
  token: string;
  csrfToken: string;
}) {
  const { t } = props;
  return (
    <section>
      <h1>{t("hostLink.heading")}</h1>
      <p>{t("hostLink.body", { title: props.title })}</p>
      <p class="warning">{t("hostLink.sharedWarning")}</p>
      <form method="post" action="/a">
        <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
        <input type="hidden" name="token" value={props.token} />
        <button type="submit">{t("hostLink.confirm")}</button>
      </form>
    </section>
  );
}
