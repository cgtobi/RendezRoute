// Fediverse login (spec 7 Identity; decision D24): the server someone logs in with, from what they
// type: a domain, a URL or a handle. Always an HTTPS origin on a public domain name; plain http, IP
// addresses, ports and single-label names only in development, for local fake servers.
import { err, ok, type Result } from "./result.ts";

const MAX_HOST_LENGTH = 253;

/** Why a fediverse login cannot start at the server someone typed. */
export type FediverseServerError = "server_invalid" | "server_not_allowed";

/** The server's origin, e.g. "https://mastodon.social"; a trailing dot is dropped. */
export function parseFediverseServer(
  input: string,
  { allowInsecure = false }: { allowInsecure?: boolean } = {},
): Result<string, "server_invalid"> {
  const invalid = err("server_invalid");
  let text = input.trim();
  // A handle: @name@server or name@server.
  const handle = /^@?[^@\s/:]+@([^@\s/]+)$/.exec(text);
  if (handle?.[1] !== undefined) text = handle[1];
  if (text === "" || /\s/.test(text)) return invalid;
  const url = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  if (url === null || url.username !== "" || url.password !== "") return invalid;
  // "mastodon.social." is the same server as "mastodon.social".
  url.hostname = url.hostname.replace(/\.$/, "");
  if (allowInsecure) {
    return url.protocol === "https:" || url.protocol === "http:" ? ok(url.origin) : invalid;
  }
  const host = url.hostname;
  const publicName =
    url.protocol === "https:" &&
    url.port === "" &&
    host.length <= MAX_HOST_LENGTH &&
    host.includes(".") &&
    // No IP literals: IPv4 dotted quads or IPv6 in brackets.
    !/^\d+(?:\.\d+){3}$/.test(host) &&
    !host.startsWith("[");
  return publicName ? ok(url.origin) : invalid;
}

/** Account IDs and usernames as servers send them: short, no spaces, no "@" or control characters. */
const ACCOUNT_ID = /^[^\s@\p{Cc}]{1,64}$/u;

/** The account a server says logged in, if what it sent looks like one; else undefined. */
export function fediverseAccount(
  id: unknown,
  username: unknown,
): { id: string; username: string } | undefined {
  return typeof id === "string" &&
    ACCOUNT_ID.test(id) &&
    typeof username === "string" &&
    ACCOUNT_ID.test(username)
    ? { id, username }
    : undefined;
}

/** Without a list every server may be used; with one only the listed hosts (FEDIVERSE_LOGIN_SERVERS). */
export function fediverseServerAllowed(
  origin: string,
  servers: readonly string[] | undefined,
): boolean {
  return servers === undefined || servers.includes(new URL(origin).host);
}
