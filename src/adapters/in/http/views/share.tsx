// Share helpers (spec 5 feature 4), as the host chose them (decision D41): the WhatsApp link
// works without JavaScript; copy and Web Share buttons start hidden and the app script reveals
// them where the browser supports them. The device's share sheet comes first: where the host
// offers it and it exists, the script hides the WhatsApp link (decision D30). Only the public plan
// link is ever shared, never a secret link; with no button chosen there is no share section.
// The section starts hidden unless it holds the WhatsApp link, so a reader without JavaScript
// never sees a heading over nothing; the app script reveals it once a button can be offered.
import type { ShareButton } from "../../../../domain/plan.ts";
import type { Translate } from "../../../i18n/i18n.ts";

export function ShareLinks({
  t,
  url,
  title,
  buttons,
}: {
  t: Translate;
  url: string;
  title: string;
  buttons: readonly ShareButton[];
}) {
  if (buttons.length === 0) return null;
  const whatsApp = `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
  return (
    <section
      class="share"
      data-share=""
      data-url={url}
      data-title={title}
      hidden={!buttons.includes("whatsApp")}
    >
      <h2>{t("share.heading")}</h2>
      <div class="share-actions">
        {buttons.includes("native") && (
          <button type="button" class="secondary" data-share-native="" hidden>
            {t("share.native")}
          </button>
        )}
        {buttons.includes("copy") && (
          <button
            type="button"
            class="secondary"
            data-share-copy=""
            data-copied={t("share.copied")}
            data-failed={t("share.copyFailed")}
            hidden
          >
            {t("share.copy")}
          </button>
        )}
        {buttons.includes("whatsApp") && (
          <a
            class="button secondary"
            data-share-app=""
            href={whatsApp}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
        )}
      </div>
      <p class="hint" data-status="" role="status"></p>
    </section>
  );
}
