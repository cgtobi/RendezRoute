// What counts as a change in the host's plan form (decision 006), apart from the DOM so it can be
// tested. A control is reduced to one string: its value, or for a checkbox or radio whether it is
// checked. The form is dirty when any of these differs from the snapshot taken at load.

export interface ControlState {
  type: string;
  name: string;
  value: string;
  checked: boolean;
}

/** Control types that hold no value the host edits: the buttons. */
const UNTRACKED_TYPES = new Set(["button", "submit", "reset", "image"]);

/**
 * Named controls that are not saved: the form map's mode switch (ADR 008). The full-screen map
 * mirrors its mode to the page, which must not make the form dirty by itself.
 */
const UNTRACKED_NAMES = new Set(["mapMode"]);

/** Whether a control is part of the form's values. Unnamed controls (search boxes) are not submitted. */
export function isTracked(control: Pick<ControlState, "type" | "name">): boolean {
  return (
    control.name !== "" && !UNTRACKED_TYPES.has(control.type) && !UNTRACKED_NAMES.has(control.name)
  );
}

/**
 * One control's value as it is compared. A file input's value is "" or the browser's fake path of
 * the chosen file (ADR 007), so choosing a file is a change.
 */
export function stateKey(control: Pick<ControlState, "type" | "value" | "checked">): string {
  return control.type === "checkbox" || control.type === "radio"
    ? control.checked
      ? "1"
      : "0"
    : control.value;
}

/**
 * One control's value as the page loaded it, for the snapshot and for Discard. A file input counts
 * as empty: the server never fills one, so a file the browser kept (back button, restored tab) has
 * not been saved and is a change.
 */
export function loadedKey(control: Pick<ControlState, "type" | "value" | "checked">): string {
  return control.type === "file" ? "" : stateKey(control);
}

/** Whether any control differs from the snapshot. A different number of controls counts as a change. */
export function isDirty(snapshot: readonly string[], current: readonly string[]): boolean {
  return snapshot.length !== current.length || snapshot.some((key, i) => key !== current[i]);
}
