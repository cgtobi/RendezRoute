// Shown once after responding (spec 3.2): the manage link exists only in this response.
import type { Translate } from "../../../i18n/i18n.ts";

export function RespondedPage(props: {
  t: Translate;
  manageUrl: string;
  planPath: string;
  /** The formatted deletion date (spec 3.10: shown in the join confirmation). */
  deletion: string;
}) {
  const { t } = props;
  return (
    <section class="links">
      <h1>{t("responded.heading")}</h1>
      <h2>{t("responded.manageLink")}</h2>
      <p class="link-box">
        <code>{props.manageUrl}</code>
      </p>
      <p class="warning">{t("responded.manageLinkWarning")}</p>
      <p>{t("plan.deletion", { date: props.deletion })}</p>
      <p>
        <a class="button" href={props.planPath}>
          {t("responded.back")}
        </a>
      </p>
    </section>
  );
}
