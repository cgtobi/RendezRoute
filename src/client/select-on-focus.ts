// Selects the text of an input on its first focus, so typing replaces it (decision D71): the plan
// form's title starts as a generic default. Only inputs marked `data-select-on-focus` take part.

export function initSelectOnFocus(root: Document = document): void {
  for (const input of root.querySelectorAll<HTMLInputElement>("input[data-select-on-focus]")) {
    input.addEventListener(
      "focus",
      () => {
        try {
          input.select();
        } catch {
          // Not a selectable input type: leave the text as it is.
        }
      },
      { once: true },
    );
  }
}
