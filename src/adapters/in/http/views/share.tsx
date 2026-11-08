// Share helpers (spec 5 feature 4): WhatsApp and X links work without JavaScript; copy and Web
// Share buttons start hidden and the app script reveals them where the browser supports them.
// Only the public plan link is ever shared, never a secret link.
import type { Translate } from "../../../i18n/i18n.ts";

export function ShareLinks({ t, url, title }: { t: Translate; url: string; title: string }) {
  const whatsApp = `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
  const x = `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
  return (
    <section class="share" data-share="" data-url={url} data-title={title}>
      <h2>{t("share.heading")}</h2>
      <div class="share-actions">
        <button type="button" data-share-native="" hidden>
          {t("share.native")}
        </button>
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
        <a class="button secondary" href={whatsApp} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
        <a class="button secondary" href={x} target="_blank" rel="noopener noreferrer">
          X
        </a>
      </div>
      <p class="hint" data-status="" role="status"></p>
    </section>
  );
}
