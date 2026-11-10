// Share helpers (spec 5 feature 4): copy and Web Share need JavaScript, so their buttons start
// hidden; the WhatsApp and X links work without it. Where the device can share, its share sheet
// already offers those apps, so their links go (decision D30).
import { shareButtons } from "./share-buttons.ts";

export function initShare(): void {
  const show = shareButtons({
    share: typeof navigator.share === "function",
    copy: navigator.clipboard !== undefined,
  });
  for (const section of document.querySelectorAll<HTMLElement>("[data-share]")) {
    const url = section.dataset.url ?? "";
    const title = section.dataset.title ?? "";
    const status = section.querySelector<HTMLElement>("[data-status]");
    const say = (text: string | undefined) => {
      if (status !== null) status.textContent = text ?? "";
    };

    for (const app of section.querySelectorAll<HTMLElement>("[data-share-app]")) {
      app.hidden = !show.apps;
    }

    const native = section.querySelector<HTMLButtonElement>("[data-share-native]");
    if (native !== null && show.native) {
      native.hidden = false;
      native.addEventListener("click", () => {
        navigator.share({ title, url }).catch(() => {
          // Cancelled by the user or not allowed; nothing to report.
        });
      });
    }

    const copy = section.querySelector<HTMLButtonElement>("[data-share-copy]");
    if (copy !== null && show.copy) {
      copy.hidden = false;
      copy.addEventListener("click", () => {
        navigator.clipboard.writeText(url).then(
          () => say(copy.dataset.copied),
          () => say(copy.dataset.failed),
        );
      });
    }
  }
}
