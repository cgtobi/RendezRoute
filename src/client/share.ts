// Share helpers (spec 5 feature 4): copy and Web Share need JavaScript, so their buttons start
// hidden; the WhatsApp link works without it. Where the host offers the share sheet and the device
// can share, the sheet already offers that app, so its link goes (decisions D30, D41).
import { shareButtons } from "./share-buttons.ts";

export function initShare(): void {
  for (const section of document.querySelectorAll<HTMLElement>("[data-share]")) {
    const native = section.querySelector<HTMLButtonElement>("[data-share-native]");
    const copy = section.querySelector<HTMLButtonElement>("[data-share-copy]");
    const apps = section.querySelectorAll<HTMLElement>("[data-share-app]");
    const show = shareButtons({
      supports: {
        share: typeof navigator.share === "function",
        copy: navigator.clipboard !== undefined,
      },
      offered: { native: native !== null, copy: copy !== null, whatsApp: apps.length > 0 },
    });
    const url = section.dataset.url ?? "";
    const title = section.dataset.title ?? "";
    const status = section.querySelector<HTMLElement>("[data-status]");
    const say = (text: string | undefined) => {
      if (status !== null) status.textContent = text ?? "";
    };

    for (const app of apps) app.hidden = !show.apps;

    if (native !== null && show.native) {
      native.hidden = false;
      native.addEventListener("click", () => {
        navigator.share({ title, url }).catch(() => {
          // Cancelled by the user or not allowed; nothing to report.
        });
      });
    }

    if (copy !== null && show.copy) {
      copy.hidden = false;
      copy.addEventListener("click", () => {
        navigator.clipboard.writeText(url).then(
          () => say(copy.dataset.copied),
          () => say(copy.dataset.failed),
        );
      });
    }
    // Starts hidden unless it holds the WhatsApp link; shown once a button in it can be used.
    section.hidden = !show.section;
  }
}
