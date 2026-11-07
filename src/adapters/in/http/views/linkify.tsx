// Plain text with auto-linked http(s) URLs (spec 3.8 Output). JSX escapes all text and
// attribute values; only http(s) URLs become links, with rel attributes for user content.
import type { Child } from "hono/jsx";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?\]]+$/;

/** Drops trailing punctuation and closing parentheses that have no opening partner in the URL. */
function trimUrl(candidate: string): string {
  let url = candidate.replace(TRAILING_PUNCTUATION, "");
  while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  }
  return url;
}

const isWebUrl = (url: string) => {
  const parsed = URL.parse(url);
  return (
    parsed !== null &&
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    parsed.hostname !== ""
  );
};

export function Linkified({ text }: { text: string }) {
  const parts: Child[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (!isWebUrl(url)) continue;
    const start = match.index;
    parts.push(text.slice(last, start));
    parts.push(
      <a href={url} rel="noopener noreferrer nofollow ugc">
        {url}
      </a>,
    );
    last = start + url.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
