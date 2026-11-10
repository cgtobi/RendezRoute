// When and where, as small boxes with icons (design decision D27): on the plan page, the template
// page and the admin's plan page.
import type { Child } from "hono/jsx";
import type { Translate } from "../../../i18n/i18n.ts";

export function WhenWhere(props: { t: Translate; when: Child; where: string }) {
  const { t } = props;
  return (
    <dl class="when-where">
      <div class="pill">
        <dt class="visually-hidden">{t("plan.when")}</dt>
        <dd>
          <span class="icon icon-calendar" aria-hidden="true"></span>
          <span>{props.when}</span>
        </dd>
      </div>
      <div class="pill">
        <dt class="visually-hidden">{t("plan.where")}</dt>
        <dd>
          <span class="icon icon-pin" aria-hidden="true"></span>
          <span>{props.where}</span>
        </dd>
      </div>
    </dl>
  );
}
