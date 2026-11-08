// Share helpers (spec 5 feature 4): copy and Web Share need JavaScript, so their buttons start
// hidden; the WhatsApp and X links work without it.

export function initShare(): void {
  for (const section of document.querySelectorAll<HTMLElement>("[data-share]")) {
    const url = section.dataset.url ?? "";
    const title = section.dataset.title ?? "";
    const status = section.querySelector<HTMLElement>("[data-status]");
    const say = (text: string | undefined) => {
      if (status !== null) status.textContent = text ?? "";
    };

    const native = section.querySelector<HTMLButtonElement>("[data-share-native]");
    if (native !== null && typeof navigator.share === "function") {
      native.hidden = false;
      native.addEventListener("click", () => {
        navigator.share({ title, url }).catch(() => {
          // Cancelled by the user or not allowed; nothing to report.
        });
      });
    }

    const copy = section.querySelector<HTMLButtonElement>("[data-share-copy]");
    if (copy !== null && navigator.clipboard !== undefined) {
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
