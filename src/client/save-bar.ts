// The host page's save bar (decision 006): while the plan form differs from what the page loaded
// with, the bar sticks to the bottom of the viewport and offers "Unsaved changes" and Discard.
// Without this script the server's markup stays as it is: the Save button only (or the problem
// state, which needs no script).
import { isDirty, isTracked, loadedKey, stateKey } from "./save-bar-rule.ts";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function initSaveBar(root: Document = document): void {
  for (const bar of root.querySelectorAll<HTMLElement>("[data-save-bar]")) {
    const form = bar.closest("form");
    // The style guide's samples have their own id prefix and stay static.
    if (form === null || form.querySelector("#field-title") === null) continue;

    const controls = (): Control[] =>
      [...form.elements].filter(
        (element): element is Control =>
          (element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement) &&
          isTracked(element),
      );
    const state = (control: Control) => ({
      type: control.type,
      value: control.value,
      checked: control instanceof HTMLInputElement && control.checked,
    });
    const keys = () => controls().map((control) => stateKey(state(control)));

    // Taken once the other page scripts have set what they prefill. A file input counts as empty
    // here (ADR 007): a file the browser restored has not been saved, so it is a change.
    const loaded = controls().map((control) => ({
      control,
      value: control.type === "file" ? "" : control.value,
      checked: control instanceof HTMLInputElement && control.checked,
    }));
    const snapshot = controls().map((control) => loadedKey(state(control)));

    const unsaved = bar.querySelector<HTMLElement>("[data-save-bar-unsaved]");
    const discard = bar.querySelector<HTMLButtonElement>("[data-save-bar-discard]");
    // With errors from the server the bar is already in its problem state and stays there.
    const problem = bar.hasAttribute("data-problem");

    const update = () => {
      const dirty = isDirty(snapshot, keys());
      if (!problem) bar.toggleAttribute("data-dirty", dirty);
      if (unsaved !== null) unsaved.hidden = problem || !dirty;
      if (discard !== null) discard.hidden = !dirty;
    };

    form.addEventListener("input", update);
    form.addEventListener("change", update);
    window.addEventListener("pageshow", update);

    discard?.addEventListener("click", () => {
      const changed: Control[] = [];
      for (const { control, value, checked } of loaded) {
        if (
          control instanceof HTMLInputElement &&
          (control.type === "checkbox" || control.type === "radio")
        ) {
          if (control.checked === checked) continue;
          control.checked = checked;
        } else if (control.type === "file") {
          // Clears the chosen file: "" is the only value a script may give a file input.
          if (control.value === "") continue;
          control.value = "";
        } else {
          if (control.value === value) continue;
          control.value = value;
        }
        changed.push(control);
      }
      // The map picker, the fold summaries and the route trim field follow the form's events, so they
      // show the restored values.
      for (const control of changed) {
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
      update();
      // The button hides itself: keep focus on the bar.
      bar.querySelector<HTMLElement>('button[type="submit"]')?.focus();
    });

    // The link to the first problem opens a closed fold around the field and focuses it.
    bar
      .querySelector<HTMLAnchorElement>("[data-save-bar-goto]")
      ?.addEventListener("click", (event) => {
        const id =
          event.currentTarget instanceof HTMLAnchorElement ? event.currentTarget.hash.slice(1) : "";
        const target = root.getElementById(id);
        if (target === null) return;
        event.preventDefault();
        for (
          let fold = target.closest("details");
          fold !== null;
          fold = fold.parentElement?.closest("details") ?? null
        ) {
          fold.open = true;
        }
        target.scrollIntoView({ block: "center" });
        const field = target.matches("input, select, textarea")
          ? target
          : (target
              .closest(".field, fieldset")
              ?.querySelector<HTMLElement>("input, select, textarea") ?? null);
        field?.focus({ preventScroll: true });
      });

    update();
  }
}
