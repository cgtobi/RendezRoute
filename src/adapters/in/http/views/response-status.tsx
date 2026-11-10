// One's own response as a status box (design decision D27), on the plan page and on one's own
// response page.
import type { Translate } from "../../../i18n/i18n.ts";
import type { OwnResponseView } from "../../../../application/plan-views.ts";
import { responseState, statusKey } from "./format.ts";
import { Status } from "./status.tsx";

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
  return (
    <Status
      state={responseState(response)}
      heading={titled ? t("plan.yourResponse") : undefined}
      text={t(statusKey(response))}
      action={action}
    />
  );
}
