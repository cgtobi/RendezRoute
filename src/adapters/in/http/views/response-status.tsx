// One's own response as a status box (design decision D27), on the plan page and on one's own
// response page; green with a tick when one is in.
import type { Translate } from "../../../i18n/i18n.ts";
import type { OwnResponseView } from "../../../../application/plan-views.ts";
import { responseState, statusKey } from "./format.ts";

export function ResponseStatus({
  t,
  response,
  action,
  titled = true,
}: {
  t: Translate;
  response: OwnResponseView;
  /** A link below the status, e.g. to change it; none on the response's own page. */
  action?: { href: string; label: string } | undefined;
  /** With the "Your response" heading; left out where the page's heading says it. */
  titled?: boolean;
}) {
  const state = responseState(response);
  return (
    <section class={`status status-${state}`}>
      {state === "joined" && (
        <span class="status-icon" aria-hidden="true">
          <span class="icon icon-check"></span>
        </span>
      )}
      <div class="status-text">
        {titled && <h2>{t("plan.yourResponse")}</h2>}
        <p>{t(statusKey(response))}</p>
      </div>
      {action !== undefined && (
        <p class="status-action">
          <a href={action.href}>{action.label}</a>
        </p>
      )}
    </section>
  );
}
