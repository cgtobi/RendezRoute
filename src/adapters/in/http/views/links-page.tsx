// Shown once after creating a plan (spec 3.2): the host link exists only in this response.
import type { Translate } from "../../../i18n/i18n.ts";

export function LinksPage(props: {
  t: Translate;
  planUrl: string;
  hostUrl: string;
  planPath: string;
  deletion: string;
}) {
  const { t } = props;
  return (
    <section class="links">
      <h1>{t("links.heading")}</h1>
      <h2>{t("links.planLink")}</h2>
      <p class="link-box">
        <a href={props.planPath}>{props.planUrl}</a>
      </p>
      <h2>{t("links.hostLink")}</h2>
      <p class="link-box">
        <code>{props.hostUrl}</code>
      </p>
      <p class="warning">{t("links.hostLinkWarning")}</p>
      <p>{t("links.deletion", { date: props.deletion })}</p>
      <p>
        <a class="button" href={props.planPath}>
          {t("links.open")}
        </a>
      </p>
    </section>
  );
}
