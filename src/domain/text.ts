// Plain-text field rules shared by forms (decision D7).
import { err, ok, type Result } from "./result.ts";

// C0 controls except tab and line feed, DEL, and C1 controls.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

export type TextError = "required" | "too_long" | "invalid_characters";

/**
 * Trims and checks a text field. Lengths count characters (code points), not UTF-16 units.
 * Single-line fields reject line breaks; multi-line fields normalize CRLF to LF.
 */
export function cleanText(
  value: string,
  { max, multiline = false }: { max: number; multiline?: boolean },
): Result<string | undefined, Exclude<TextError, "required">> {
  const normalized = (multiline ? value.replace(/\r\n?/g, "\n") : value).normalize("NFC").trim();
  if (normalized === "") return ok(undefined);
  if (CONTROL.test(normalized) || (!multiline && /[\n\t]/.test(normalized))) {
    return err("invalid_characters");
  }
  if (Array.from(normalized).length > max) return err("too_long");
  return ok(normalized);
}
