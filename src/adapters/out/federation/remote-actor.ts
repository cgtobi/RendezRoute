// Finding a fediverse account's actor from its address, @name@host (spec 7 Optional notification
// channels, decision D47): WebFinger at the address's own server, then the actor document it names.
// Every request goes through OutboundHttp (SSRF rules, redirects checked hop by hop, size limit,
// timeout), and what comes back is read, never trusted: only JSON, only the fields needed, nothing
// parsed as HTML. The answer must stay on the address's own host: the actor is on that host, its
// inbox is on the actor's host, and its name is the one in the address, so a server cannot make
// this site write to someone else's inbox by lying. Servers that serve their accounts from another
// host than the one in the address (split domains) are therefore not supported. Nothing is logged
// or stored.
import type { OutboundHttp, RemoteActorLookup } from "../../../application/ports.ts";
import { fediverseAddress } from "../../../domain/actor.ts";
import { fediverseAccount, parseFediverseServer } from "../../../domain/fediverse.ts";
import { OutboundError } from "../http/outbound-http.ts";

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;
/** Links read from a WebFinger answer: a server has a handful. */
const MAX_LINKS = 50;
/** The `type` of the link to an actor: Mastodon writes the first, others the second with a profile. */
const isActivityType = (type: unknown): boolean =>
  typeof type === "string" &&
  (type === "application/activity+json" || type.startsWith("application/ld+json"));
const ACCEPT_ACTOR =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

type Fetched =
  | { kind: "document"; document: Record<string, unknown>; url: URL }
  | { kind: "not_found" }
  | { kind: "unavailable" };

/**
 * Whether the request was refused by the SSRF rules or the limits, which no retry changes, and
 * not lost to the network.
 */
const refusedForGood = (error: unknown): boolean =>
  error instanceof OutboundError &&
  ["Request blocked", "Only https", "Too many redirects", "Response too large"].some((start) =>
    error.message.startsWith(start),
  );

/** An address with a user name or password in it is no actor or inbox this site writes to. */
const hasCredentials = (url: URL): boolean => url.username !== "" || url.password !== "";

export function createRemoteActorLookup({
  http,
  allowInsecure = false,
}: {
  http: OutboundHttp;
  /** Plain http, for local fake servers in development (ALLOW_INSECURE_DEV). */
  allowInsecure?: boolean;
}): RemoteActorLookup {
  const schemes = allowInsecure ? ["https:", "http:"] : ["https:"];

  async function fetchJson(url: URL, accept: string): Promise<Fetched> {
    let response: Awaited<ReturnType<OutboundHttp["get"]>>;
    try {
      response = await http.get(url, {
        headers: { accept },
        maxBytes: MAX_BYTES,
        timeoutMs: TIMEOUT_MS,
      });
    } catch (error) {
      return refusedForGood(error) ? { kind: "not_found" } : { kind: "unavailable" };
    }
    const { status } = response;
    // A busy or failing server may answer later; any other answer but success is final.
    if (status === 408 || status === 429 || status >= 500) return { kind: "unavailable" };
    // The client enforces the limit; an answer over it from any other is no actor either.
    if (status !== 200 || response.body.byteLength > MAX_BYTES) return { kind: "not_found" };
    try {
      const document = JSON.parse(new TextDecoder().decode(response.body)) as unknown;
      return typeof document === "object" && document !== null && !Array.isArray(document)
        ? { kind: "document", document: document as Record<string, unknown>, url: response.url }
        : { kind: "not_found" };
    } catch {
      return { kind: "not_found" };
    }
  }

  return {
    async resolve(handle) {
      const notFound = { kind: "not_found" } as const;
      // @name@host: both parts are checked before any request goes out.
      const text = handle.startsWith("@") ? handle.slice(1) : handle;
      const at = text.indexOf("@");
      if (at < 1 || text.indexOf("@", at + 1) !== -1) return notFound;
      const name = text.slice(0, at);
      const typed = text.slice(at + 1).toLowerCase();
      const server = parseFediverseServer(typed, { allowInsecure });
      if (!server.ok || fediverseAccount(name, name) === undefined) return notFound;
      const origin = new URL(server.value);
      // Only a host: a path or a port the address does not name is not part of it.
      if (origin.host !== (typed.endsWith(".") ? typed.slice(0, -1) : typed)) return notFound;
      const address = fediverseAddress(name, origin.host).slice(1);

      const finger = new URL("/.well-known/webfinger", origin);
      finger.searchParams.set("resource", `acct:${address}`);
      const found = await fetchJson(finger, "application/jrd+json, application/json");
      if (found.kind !== "document") return found;
      // A redirect may only have stayed on the address's own host.
      if (found.url.host !== origin.host) return notFound;
      // The answer must be about the address asked for: a server that answers for another
      // account is not believed. Servers write the subject with the address as they know it.
      const { subject } = found.document;
      if (
        typeof subject !== "string" ||
        subject.toLowerCase() !== `acct:${address}`.toLowerCase()
      ) {
        return notFound;
      }

      const links = Array.isArray(found.document.links) ? found.document.links : [];
      const self = (links.slice(0, MAX_LINKS) as unknown[]).find(
        (link): link is { href: unknown; type: unknown } =>
          typeof link === "object" &&
          link !== null &&
          (link as { rel?: unknown }).rel === "self" &&
          isActivityType((link as { type?: unknown }).type),
      );
      const actorUrl = typeof self?.href === "string" ? URL.parse(self.href) : null;
      if (
        actorUrl === null ||
        hasCredentials(actorUrl) ||
        !schemes.includes(actorUrl.protocol) ||
        actorUrl.host !== origin.host
      ) {
        return notFound;
      }

      const actor = await fetchJson(actorUrl, ACCEPT_ACTOR);
      if (actor.kind !== "document") return actor;
      const { id, inbox, preferredUsername } = actor.document;
      const inboxUrl = typeof inbox === "string" ? URL.parse(inbox) : null;
      if (
        actor.url.host !== origin.host ||
        typeof id !== "string" ||
        URL.parse(id)?.href !== actorUrl.href ||
        typeof preferredUsername !== "string" ||
        preferredUsername.toLowerCase() !== name.toLowerCase() ||
        inboxUrl === null ||
        hasCredentials(inboxUrl) ||
        !schemes.includes(inboxUrl.protocol) ||
        inboxUrl.host !== actorUrl.host
      ) {
        return notFound;
      }
      // The actor's own inbox, never a shared one: the message is for this person alone.
      return {
        kind: "found",
        actor: { id: actorUrl.href, inbox: inboxUrl.href, sharedInbox: undefined },
      };
    },
  };
}
