// Helpers for the one line field style (decision D73): which inputs are text-like, and the
// "Required" hint under a required control. The look and the showing and hiding of the hint are
// CSS (public/app.css), so they work without JavaScript.
import type { Translate } from "../../../i18n/i18n.ts";

/** Input types drawn as a line; an input without a type is text. */
const TEXT_LIKE_TYPES = ["text", "email", "url", "search", "number", "tel", "password"];

/** Whether a control of this input type (undefined: no type attribute) is a text-like field. */
export function isTextLike(type: string | undefined): boolean {
  return type === undefined || TEXT_LIKE_TYPES.includes(type);
}

/** The id of the "Required" hint that belongs to the control with this id. */
function requiredHintId(controlId: string): string {
  return `${controlId}-required`;
}

/** An `aria-describedby` value from the ids that exist; undefined when there are none. */
export function describedBy(...ids: readonly (string | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => id !== undefined && id !== "");
  return present.length === 0 ? undefined : present.join(" ");
}

/**
 * "Required", right after a required control. Not rendered
 * while the field shows an error: the error message takes its place. CSS shows it only while the
 * control is empty. It is purely visual: aria-hidden, and never named in aria-describedby, because
 * aria-required already carries the meaning. Date and time controls get none (D74).
 */
export function RequiredHint({
  t,
  controlId,
  invalid = false,
}: {
  t: Translate;
  controlId: string;
  invalid?: boolean;
}) {
  if (invalid) return null;
  return (
    <p class="required-hint" id={requiredHintId(controlId)} aria-hidden="true">
      {t("field.requiredHint")}
    </p>
  );
}
