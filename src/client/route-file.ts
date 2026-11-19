// The route file field of the plan forms (/new and the host page, ADR 007). The "hide the start
// and end" choice shows once a file is chosen, and a file over the server's limit is refused
// before it is sent: the browser shows the message at the field and blocks the submit, as it does
// for an empty required field. Without this script the choice stays visible with its hint, and the
// server checks the size.
import { sizeProblem, trimHidden } from "./route-file-rule.ts";

export function initRouteFile(root: Document = document): void {
  for (const form of root.querySelectorAll("form")) {
    const file = form.querySelector<HTMLInputElement>('input#field-gpx[type="file"]');
    const trim = form.querySelector<HTMLElement>("[data-gpx-trim]");
    if (file === null || trim === null) continue;

    const update = () => {
      const files = file.files;
      trim.hidden = trimHidden(files?.length ?? 0);
      file.setCustomValidity(
        sizeProblem(files?.[0]?.size, file.dataset.maxBytes, file.dataset.tooLarge),
      );
    };

    // Discard in the save bar clears the file and sends both events; a page from the back-forward
    // cache keeps its file and shows again with "pageshow".
    file.addEventListener("change", update);
    file.addEventListener("input", update);
    window.addEventListener("pageshow", update);
    update();
  }
}
