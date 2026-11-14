// The admin listener behind Home Assistant Ingress (decision D56). Two middlewares:
//
// - `ingressGate`: who may talk to this listener at all. The Supervisor connects from its own
//   address and vouches for the signed-in user in `X-Remote-User-Groups`; the application port
//   (`IngressAdminAuth`) decides from the socket's peer address and that header. Nothing else is
//   trusted: not X-Forwarded-For, not X-Ingress-Path, nothing from any other peer. A request from
//   another peer gets a plain-text 403 that does not say why (no page, no instance name, no
//   assets); the trusted peer without the admin group is told what Home Assistant needs in a page.
//   The body limit (app-common.tsx) runs before the gate, so an oversized post from any peer is
//   answered 413 first; that page is no secret either.
//   The Supervisor has set `X-Remote-User-Id` since 2023; without it the gate answers the same
//   explanatory 403 as for a missing groups header (the text names the Home Assistant version
//   that sends both), so the user id the token is bound to is never guessed.
// - `ingressCsrfGuard`: CSRF protection by a stateless token bound to the user (decision I74;
//   this mode sets no cookie). Home Assistant Core forces `Referrer-Policy: no-referrer`, so the
//   panel's form posts arrive with `Origin: null`, and over plain http Sec-Fetch-* is absent.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import type { IngressAdminAuth } from "../../../application/ports.ts";
import { CSRF_FIELD } from "./csrf.ts";
import { messagePage } from "./routes/shared.tsx";
import type { AppEnv } from "./app.tsx";

/** Sent by the Supervisor since 2026.10.4, which also strips client-sent copies in any case. */
const GROUPS_HEADER = "x-remote-user-groups";

/** The TCP peer address of the connection; undefined without a socket (app.request in tests). */
export function peerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

export function ingressGate(ingress: IngressAdminAuth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const decision = ingress.check({ peer: peerAddress(c), groups: c.req.header(GROUPS_HEADER) });
    // The user id is read only once the peer and the groups are accepted, never from another peer.
    if (decision.kind === "allowed" && (c.req.header(USER_HEADER) ?? "") !== "") return next();
    // Every admin response is neither stored nor indexed, refusals too (messagePage does it for
    // pages under /admin/; the others get the same header here).
    c.header("cache-control", "no-store");
    // Another peer gets nothing at all: no page, no assets, no reason.
    const explain = decision.kind === "allowed" || decision.reason === "not_admin";
    if (!explain) return c.text("Forbidden", 403);
    // The Supervisor's user who is no admin is told why in a styled page; its assets load.
    if (c.req.path.startsWith("/static/")) return next();
    return messagePage(c, 403, c.get("t")("admin.ingressDenied"));
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The Supervisor's name for the signed-in Home Assistant user; the token is bound to it. */
const USER_HEADER = "x-remote-user-id";

/** The UTC date, YYYY-MM-DD: the token's day bucket. */
const dayOf = (at: Date) => at.toISOString().slice(0, 10);

/**
 * HMAC(key, "ingress-csrf\n<user id>\n<day>"): the prefix keeps this MAC apart from any other use
 * of the key. The newline cannot occur in a header value, so no two pairs collide.
 */
function sign(key: Buffer, userId: string, day: string): string {
  return createHmac("sha256", key).update(`ingress-csrf\n${userId}\n${day}`).digest("base64url");
}

/** An Origin the page may send: "null" (no-referrer form posts) or the request's own host. */
function originIsOurs(c: Context, origin: string): boolean {
  if (origin === "null") return true;
  const host = c.req.header("host")?.toLowerCase();
  const originHost = URL.parse(origin)?.host;
  return host !== undefined && originHost !== undefined && originHost === host;
}

export interface IngressCsrfOptions {
  /** The admin CSRF key (deriveKey "csrf-admin"), the same one the token-mode admin app uses. */
  key: Buffer;
  now: () => Date;
}

/**
 * CSRF protection in Ingress mode (decision I74), with no cookie. Runs after `ingressGate`, so the
 * peer and the groups are already accepted and `X-Remote-User-Id` is present and from the
 * Supervisor. Every state-changing request needs the `_csrf` form field = HMAC(key, user id +
 * UTC day), today's or yesterday's. The token is no use to another user or to the public app
 * (other key). Browsers send Sec-Fetch-* only to https and localhost, so over plain http to a LAN
 * host the metadata is absent and the token alone decides; when the metadata is sent it must also
 * say same-origin (and an Origin must be "null" or the Host), as an extra layer.
 */
export function ingressCsrfGuard({ key, now }: IngressCsrfOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = c.req.header(USER_HEADER) ?? "";
    c.set("csrfToken", () => sign(key, userId, dayOf(now())));
    if (SAFE_METHODS.has(c.req.method)) return next();
    const refuse = () => messagePage(c, 403, c.get("t")("error.csrf"));

    const fetchSite = c.req.header("sec-fetch-site");
    const origin = c.req.header("origin");
    if (
      (fetchSite !== undefined && fetchSite !== "same-origin") ||
      (origin !== undefined && !originIsOurs(c, origin))
    ) {
      return refuse();
    }

    let submitted: string | undefined;
    const type = c.req.header("content-type") ?? "";
    if (
      type.startsWith("application/x-www-form-urlencoded") ||
      type.startsWith("multipart/form-data")
    ) {
      try {
        const field = (await c.req.parseBody())[CSRF_FIELD];
        if (typeof field === "string") submitted = field;
      } catch {
        // Malformed body: treated as a missing token.
      }
    }
    if (submitted === undefined) return refuse();

    const actual = Buffer.from(submitted);
    const today = now();
    const accepted = [today, new Date(today.getTime() - 24 * 60 * 60 * 1000)].map((at) =>
      Buffer.from(sign(key, userId, dayOf(at))),
    );
    // Both are compared whatever the first says, so timing tells nothing about which day matched.
    const matches = accepted.map((expected) => {
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
    if (!matches.some(Boolean)) return refuse();
    return next();
  };
}
