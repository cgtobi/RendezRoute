// A remote participant's reply as a recap contribution's text and link (decisions D44, D45): the
// `Note`'s HTML reduced to plain text, the first web link split off into the link field. Nothing is
// truncated: the contribution's limits (1,000 and 2,000 characters) reject what is too long. The
// input is remote and unchecked, so it is worked through in one linear scan, never with a regex
// that can backtrack across the whole string.
import { stripBidiControls } from "../../../domain/text.ts";

/** Content beyond this is not worked through: it could never fit a contribution anyway. */
const MAX_HTML = 20_000;

export interface ReplyContent {
  body: string;
  link: string | undefined;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes named and numeric entities once; anything unknown or out of range stays as written. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** An http(s) address with a host, as the contribution's own check will take it. */
const webLink = (value: string | undefined): string | undefined => {
  const parsed = value === undefined ? null : URL.parse(value.trim());
  return parsed !== null &&
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    parsed.hostname !== ""
    ? (value ?? "").trim()
    : undefined;
};

/** A tag: `<` up to the next `>`; what is not inside one is a plain string. */
interface Tag {
  name: string;
  closing: boolean;
  /** What follows the name, up to the `>`. */
  rest: string;
}
type Token = string | Tag;

const isWordCode = (code: number): boolean =>
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90) ||
  code === 95 ||
  (code >= 97 && code <= 122);

function parseTag(inside: string): Tag {
  const closing = inside.startsWith("/");
  const start = closing ? 1 : 0;
  let end = start;
  while (end < inside.length && isWordCode(inside.charCodeAt(end))) end += 1;
  return { name: inside.slice(start, end).toLowerCase(), closing, rest: inside.slice(end) };
}

/**
 * Splits at tags in one pass. The next `>` is remembered, so a run of `<` without one costs a
 * single search, and a `<` with no `>` anywhere after it is text.
 */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let textFrom = 0;
  let next = 0;
  let close = -2;
  for (;;) {
    const open = html.indexOf("<", next);
    if (open === -1) break;
    if (close !== -1 && close < open) close = html.indexOf(">", open);
    if (close === -1) break;
    if (open > textFrom) tokens.push(html.slice(textFrom, open));
    tokens.push(parseTag(html.slice(open + 1, close)));
    textFrom = close + 1;
    next = textFrom;
  }
  if (textFrom < html.length) tokens.push(html.slice(textFrom));
  return tokens;
}

const isClosing = (token: Token | undefined, name: string): boolean =>
  token !== undefined &&
  typeof token !== "string" &&
  token.closing &&
  token.name === name &&
  token.rest.trim() === "";

/** The index of the last closing tag of each name, so an unclosed opener never searches. */
function lastClosings(tokens: readonly Token[], names: readonly string[]): Map<string, number> {
  const last = new Map<string, number>();
  tokens.forEach((token, index) => {
    for (const name of names) if (isClosing(token, name)) last.set(name, index);
  });
  return last;
}

/** The index of the first closing tag of `name` after `from`; callers know there is one. */
function closingAfter(tokens: readonly Token[], from: number, name: string): number {
  let index = from + 1;
  while (index < tokens.length && !isClosing(tokens[index], name)) index += 1;
  return index;
}

/** Scripts and styles are not text: from an opener to its closer, only where there is a closer. */
function withoutScripts(tokens: readonly Token[]): Token[] {
  const last = lastClosings(tokens, ["script", "style"]);
  const kept: Token[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (
      typeof token !== "string" &&
      !token.closing &&
      (token.name === "script" || token.name === "style") &&
      index < (last.get(token.name) ?? -1)
    ) {
      index = closingAfter(tokens, index, token.name);
      continue;
    }
    kept.push(token);
  }
  return kept;
}

/** What a tag leaves in the text: line breaks for `<br>` and the end of a paragraph. */
const tagText = (tag: Tag): string =>
  tag.closing
    ? tag.name === "p" && tag.rest.trim() === ""
      ? "\n\n"
      : ""
    : tag.name === "br"
      ? "\n"
      : "";

const render = (tokens: readonly Token[], breaks: boolean): string =>
  tokens
    .map((token) => (typeof token === "string" ? token : breaks ? tagText(token) : ""))
    .join("");

/** The attributes of a tag by lower-case name, the first of each name, entities decoded. */
function attributesOf(rest: string): Map<string, string> {
  const found = new Map<string, string>();
  const spaced = (code: number | undefined): boolean =>
    code !== undefined && (code === 32 || (code >= 9 && code <= 13));
  let at = 0;
  while (at < rest.length) {
    while (spaced(rest.charCodeAt(at))) at += 1;
    const nameFrom = at;
    while (at < rest.length && rest[at] !== "=" && !spaced(rest.charCodeAt(at))) at += 1;
    const name = rest.slice(nameFrom, at).toLowerCase();
    while (spaced(rest.charCodeAt(at))) at += 1;
    if (rest[at] !== "=") {
      if (at === nameFrom) at += 1;
      continue;
    }
    at += 1;
    while (spaced(rest.charCodeAt(at))) at += 1;
    const quote = rest[at];
    let value: string | undefined;
    if (quote === '"' || quote === "'") {
      const end = rest.indexOf(quote, at + 1);
      if (end === -1) break;
      value = rest.slice(at + 1, end);
      at = end + 1;
    } else {
      const valueFrom = at;
      while (
        at < rest.length &&
        !spaced(rest.charCodeAt(at)) &&
        rest[at] !== '"' &&
        rest[at] !== "'"
      ) {
        at += 1;
      }
      value = rest.slice(valueFrom, at);
      if (value === "") continue;
    }
    if (name !== "" && !found.has(name)) found.set(name, decodeEntities(value));
  }
  return found;
}

const OPENERS: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{", ">": "<" };

/**
 * The end of an address that runs to `to`, less what only closes the sentence: `.,;:!?'"` always,
 * and a closing bracket only when the address holds more of it than of its opener (a Wikipedia
 * address keeps its own pair). One count, then one pass back from the end.
 */
function trimmedEnd(text: string, from: number, to: number): number {
  const counts = new Map<string, number>();
  for (let at = from; at < to; at += 1) {
    const char = text.charAt(at);
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let end = to;
  while (end > from) {
    const char = text.charAt(end - 1);
    const opener = OPENERS[char];
    const unmatched = opener !== undefined && (counts.get(char) ?? 0) > (counts.get(opener) ?? 0);
    if (!".,;:!?'\"".includes(char) && !unmatched) break;
    counts.set(char, (counts.get(char) ?? 0) - 1);
    end -= 1;
  }
  return end;
}

/** The first http(s) address written out in the text, and where it starts and ends. */
function bareLink(text: string): { address: string; from: number; to: number } | undefined {
  const pattern = /https?:\/\//gi;
  for (let found = pattern.exec(text); found !== null; found = pattern.exec(text)) {
    let to = found.index;
    while (to < text.length && !/\s/u.test(text.charAt(to))) to += 1;
    const end = trimmedEnd(text, found.index, to);
    const address = webLink(text.slice(found.index, end));
    if (address !== undefined) return { address, from: found.index, to: end };
    pattern.lastIndex = Math.max(to, found.index + 1);
  }
  return undefined;
}

/**
 * The text without the address at `from`..`to`, tidied at that point only: brackets left empty by
 * the cut go, and so does the space before a punctuation mark that now follows the text.
 */
function withoutAddress(text: string, from: number, to: number): string {
  let before = text.slice(0, from);
  let after = text.slice(to);
  const closer = after.charAt(0);
  const opener = before.charAt(before.length - 1);
  if (OPENERS[closer] !== undefined && OPENERS[closer] === opener) {
    before = before.slice(0, -1);
    after = after.slice(1);
  }
  if (after !== "" && ".,;:!?".includes(after.charAt(0))) {
    // Back over the blanks one by one: an end-anchored regex would retry from every blank.
    let cut = before.length;
    while (cut > 0 && " \t\u00a0".includes(before.charAt(cut - 1))) cut -= 1;
    before = before.slice(0, cut);
  }
  return before + after;
}

/** The plain text and the link of a reply's HTML; `attachments` are the addresses of its Link attachments. */
export function replyContent(
  html: string,
  attachments: readonly string[],
  maxLength: number = MAX_HTML,
): ReplyContent | undefined {
  if (html.length > maxLength) return undefined;
  const tokens = withoutScripts(tokenize(html));
  const lastAnchor = lastClosings(tokens, ["a"]).get("a") ?? -1;
  let link: string | undefined;
  let written = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (typeof token === "string") {
      written += token;
    } else if (token.closing || token.name !== "a" || index >= lastAnchor) {
      written += tagText(token);
    } else {
      const end = closingAfter(tokens, index, "a");
      const inner = tokens.slice(index + 1, end);
      const attributes = attributesOf(token.rest);
      const kind = `${attributes.get("class") ?? ""} ${attributes.get("rel") ?? ""}`;
      // A mention or hashtag is text, not the link of the contribution.
      const address = /\b(mention|hashtag|tag)\b/i.test(kind)
        ? undefined
        : webLink(attributes.get("href"));
      if (address === undefined || link !== undefined) {
        written += render(inner, true);
      } else {
        link = address;
        // The address written out as the link's text would only repeat the link field.
        written +=
          decodeEntities(render(inner, false)).trim() === address ? "" : render(inner, true);
      }
      index = end;
    }
  }
  // Control characters (but not line breaks) become spaces, the characters that reorder text go.
  let text = stripBidiControls(decodeEntities(written)).replace(/[^\P{Cc}\n]/gu, " ");
  if (link === undefined) {
    const bare = bareLink(text);
    if (bare !== undefined) {
      link = bare.address;
      text = withoutAddress(text, bare.from, bare.to);
    }
  }
  const body = text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    body,
    link: link ?? attachments.map(webLink).find((address) => address !== undefined),
  };
}
