// Plain-text field rules shared by forms (decision D7).
import { err, ok, type Result } from "./result.ts";

// C0 controls except tab and line feed, DEL, and C1 controls.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

/**
 * Characters that reorder or isolate text and can disguise what is written: embeddings and
 * overrides (U+202A to U+202E) and isolates (U+2066 to U+2069). Refused in every text field; plain
 * direction marks stay allowed, because right-to-left scripts use them.
 */
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/u;

/**
 * A web address: "scheme://", "www." or "mailto:" and what follows up to a space or a quote, the
 * way the page links them. Matches consume the whole address, so one address counts once.
 */
const URL_LIKE = /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\bmailto:)[^\s<>"']*/giu;

/** How many web addresses a text contains. */
export function countUrls(text: string): number {
  return text.match(URL_LIKE)?.length ?? 0;
}

export type TextError =
  | "required"
  | "too_long"
  | "invalid_characters"
  | "urls_not_allowed"
  | "too_many_urls";

/** The most web addresses a free-text field (note, request note, recap post) takes. */
export const MAX_URLS_IN_TEXT = 3;

/** How many web addresses a field takes: none (names, titles, places) or at most a number. */
export type UrlRule = "none" | { max: number };

/**
 * Trims and checks a text field. Lengths count characters (code points), not UTF-16 units.
 * Single-line fields reject line breaks; multi-line fields normalize CRLF to LF.
 */
export function cleanText(
  value: string,
  {
    max,
    multiline = false,
    urls,
  }: { max: number; multiline?: boolean; urls?: UrlRule | undefined },
): Result<string | undefined, Exclude<TextError, "required">> {
  const normalized = (multiline ? value.replace(/\r\n?/g, "\n") : value).normalize("NFC").trim();
  if (normalized === "") return ok(undefined);
  if (
    CONTROL.test(normalized) ||
    BIDI_OVERRIDES.test(normalized) ||
    (!multiline && /[\n\t]/.test(normalized))
  ) {
    return err("invalid_characters");
  }
  if (Array.from(normalized).length > max) return err("too_long");
  if (urls !== undefined) {
    const found = countUrls(normalized);
    if (urls === "none" && found > 0) return err("urls_not_allowed");
    if (urls !== "none" && found > urls.max) return err("too_many_urls");
  }
  return ok(normalized);
}

/** Characters that reorder or isolate text (embeddings, overrides, isolates, direction marks). */
const BIDI_CONTROLS = /[‪-‮⁦-⁩‎‏؜]/gu;

/** Text without the characters that make it display in another order than it is written. */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, "");
}
