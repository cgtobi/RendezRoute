// Instant apply for the language, units and theme selects (decisions D64, I82): picking a value
// submits its form at once. Without this script the Change button stays and works as before.
import { waitsForConfirmation } from "./auto-submit-rule.ts";

export function initAutoSubmit(root: Document = document): void {
  for (const select of root.querySelectorAll<HTMLSelectElement>("select[data-auto-submit]")) {
    const form = select.form;
    if (form === null) continue;
    form.querySelector<HTMLButtonElement>('button[type="submit"]')?.setAttribute("hidden", "");

    let lastKey: string | undefined;
    // The value the page was rendered with; a pending key-chosen value is compared against it.
    let applied = select.value;
    let pending = false;
    const submit = () => {
      pending = false;
      if (select.value === applied) return;
      applied = select.value;
      form.requestSubmit();
    };

    select.addEventListener("keydown", (event) => {
      lastKey = event.key;
      if (event.key === "Enter" && pending) {
        event.preventDefault();
        submit();
      }
    });
    // A mouse or touch pick after an arrow key must submit at once, so any pointer use forgets the key.
    for (const type of ["pointerdown", "mouseup", "click"]) {
      select.addEventListener(type, () => {
        lastKey = undefined;
      });
    }
    // Restored from the back-forward cache: the select shows what the page last had.
    window.addEventListener("pageshow", () => {
      applied = select.value;
      pending = false;
    });
    select.addEventListener("change", () => {
      if (waitsForConfirmation(lastKey)) {
        pending = true;
        return;
      }
      submit();
    });
    select.addEventListener("blur", () => {
      if (pending) submit();
    });
  }
}
