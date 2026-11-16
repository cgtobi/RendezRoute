// The creation form's fold summaries follow what the host changes (decision D61): "Who can join
// and find it" and "Exact meeting point". Without this script the server-rendered text stays,
// which is right at render. The other summaries (route, look, after the run) stay as rendered.
import { isPublicKey, openClosedDetails, parseSummaries, summaryKey } from "./fold-summary-rule.ts";

export function initFoldSummaries(root: Document = document): void {
  for (const form of root.querySelectorAll<HTMLFormElement>("form.plan-form")) {
    const checked = (name: string) =>
      form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked:not(:disabled)`)?.value;
    const value = (name: string) =>
      form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? "";

    // Parsed once: the texts the server rendered do not change.
    const folds = [...form.querySelectorAll<HTMLElement>("details[data-summary-kind]")].map(
      (fold) => ({
        fold,
        kind: fold.dataset.summaryKind,
        summaries: parseSummaries(fold.dataset.summaries),
        target: fold.querySelector<HTMLElement>(".fold-value"),
      }),
    );

    const update = () => {
      const state = {
        join: checked("joinMode"),
        find: checked("visibility"),
        exact: [value("exactDescription"), value("exactLat"), value("exactLng")],
      };
      for (const { fold, kind, summaries, target } of folds) {
        const key = summaryKey(kind, state);
        const text = summaries[key];
        if (text !== undefined && target !== null) target.textContent = text;
        if (kind === "who") fold.classList.toggle("fold-warning", isPublicKey(key));
      }
    };
    form.addEventListener("change", update);
    form.addEventListener("input", update);
    // Browsers restore form values on reload and history navigation: show what is restored.
    update();
    window.addEventListener("pageshow", update);

    // A required or invalid control in a closed details opens it before the browser reports it.
    form.addEventListener(
      "invalid",
      (event) => {
        if (event.target instanceof Element) openClosedDetails(event.target);
      },
      true,
    );
  }
}
