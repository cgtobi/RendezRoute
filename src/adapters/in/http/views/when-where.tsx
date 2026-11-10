// When and where (design decisions D27, D30), labelled for screen readers: as small boxes with icons
// on the template page and the admin's plan page, as plain lines on the plan page.
import type { Child } from "hono/jsx";
import type { Translate } from "../../../i18n/i18n.ts";

interface WhenWhereProps {
  t: Translate;
  when: Child;
  where: string;
}

export function WhenWhere({ t, when, where }: WhenWhereProps) {
  return (
    <dl class="when-where">
      <div class="pill">
        <dt class="visually-hidden">{t("plan.when")}</dt>
        <dd>
          <span class="icon icon-calendar" aria-hidden="true"></span>
          <span>{when}</span>
        </dd>
      </div>
      <div class="pill">
        <dt class="visually-hidden">{t("plan.where")}</dt>
        <dd>
          <span class="icon icon-pin" aria-hidden="true"></span>
          <span>{where}</span>
        </dd>
      </div>
    </dl>
  );
}

/** The date, then the place in a quieter line below (the plan page, D30). */
export function WhenWhereLines({ t, when, where }: WhenWhereProps) {
  return (
    <dl class="when-where lines">
      <div>
        <dt class="visually-hidden">{t("plan.when")}</dt>
        <dd>{when}</dd>
      </div>
      <div>
        <dt class="visually-hidden">{t("plan.where")}</dt>
        <dd>{where}</dd>
      </div>
    </dl>
  );
}
