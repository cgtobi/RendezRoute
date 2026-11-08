// "Notify me about this plan" (spec 6 feature 3, decision D17). Hidden until the app script finds
// push support; the plan works the same without it (acceptance criterion: push denied).
import type { Translate } from "../../../i18n/i18n.ts";

export interface PushSettings {
  /** JSON endpoint for this response's or this host's switch. */
  endpoint: string;
  vapidPublicKey: string;
}

export function PushSwitch({
  t,
  push,
  hint,
  offOnly = false,
}: {
  t: Translate;
  push: PushSettings;
  hint: string;
  /** Rejected and removed people may only turn notifications off (spec 3.5). */
  offOnly?: boolean;
}) {
  return (
    <div
      class="push"
      data-push=""
      data-endpoint={push.endpoint}
      data-vapid-key={push.vapidPublicKey}
      data-label-on={t("push.enable")}
      data-label-off={t("push.disable")}
      data-on-text={t("push.on")}
      data-blocked={t("push.blocked")}
      data-failed={t("push.failed")}
      data-off-only={offOnly ? "" : undefined}
      hidden
    >
      <p class="hint">{hint}</p>
      <button type="button" class="secondary" data-push-toggle="">
        {t("push.enable")}
      </button>
      <p class="hint" data-status="" role="status"></p>
    </div>
  );
}
