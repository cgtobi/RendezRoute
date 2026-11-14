// CSRF protection (spec 3.8, decision I8): signed double-submit token plus origin check.
// The cookie holds only a random value, is session-scoped and is set only when a page
// renders a form. The token in the form is HMAC(key, cookie value).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";

export type CsrfEnv = { Variables: { csrfToken: () => string } };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);
const COOKIE_VALUE = /^[A-Za-z0-9_-]{43}$/;
export const CSRF_FIELD = "_csrf";

export interface CsrfOptions {
  key: Buffer;
  config: Config;
  /**
   * Posts that carry their own secret and no cookie: one-click unsubscribe from the mail app
   * (decision D31), later the signature-verified ActivityPub inbox.
   */
  exempt?: ((method: string, path: string) => boolean) | undefined;
  /** Renders the 403 response; the app supplies a translated page. */
  onReject?: ((c: Context) => Response | Promise<Response>) | undefined;
  /** The token cookie; the admin listener has its own (decision D55). */
  cookie?:
    | { name: string; sameSite: "Lax" | "Strict"; secure: (c: Context) => boolean }
    | undefined;
  /** Whether an `Origin` header (other than "null") names this app; default: BASE_URL's origin. */
  isOwnOrigin?: ((c: Context, origin: string) => boolean) | undefined;
}

export function csrf({
  key,
  config,
  exempt = () => false,
  onReject = (c) => c.body(null, 403),
  cookie = {
    name: config.allowInsecureDev ? "rr-csrf" : "__Host-rr-csrf",
    sameSite: "Lax",
    secure: () => !config.allowInsecureDev,
  },
  isOwnOrigin = (_c, origin) => origin === config.baseUrl.origin,
}: CsrfOptions): MiddlewareHandler<CsrfEnv> {
  const cookieName = cookie.name;
  const sign = (value: string) => createHmac("sha256", key).update(value).digest("base64url");

  return async (c, next) => {
    let value = getCookie(c, cookieName);
    if (value !== undefined && !COOKIE_VALUE.test(value)) value = undefined;

    c.set("csrfToken", () => {
      if (value === undefined) {
        value = randomBytes(32).toString("base64url");
        setCookie(c, cookieName, value, {
          httpOnly: true,
          secure: cookie.secure(c),
          sameSite: cookie.sameSite,
          path: "/",
        });
      }
      return sign(value);
    });

    if (SAFE_METHODS.has(c.req.method) || exempt(c.req.method, c.req.path)) return next();

    const forbidden = () => onReject(c);

    const origin = c.req.header("origin");
    const fetchSite = c.req.header("sec-fetch-site");
    const fromHere =
      origin === "null"
        ? // Pages served with Referrer-Policy: no-referrer (secret links, spec 3.8) make browsers
          // send "Origin: null" with their forms. Only Sec-Fetch-Site may vouch for those, and only
          // as same-origin: no form of ours is sent as "none", and without the header (older
          // browsers, stripping extensions) a null origin stays refused (decision I53).
          fetchSite === "same-origin"
        : origin !== undefined
          ? isOwnOrigin(c, origin)
          : fetchSite === undefined || ALLOWED_FETCH_SITES.has(fetchSite);
    if (!fromHere) return forbidden();

    let submitted = c.req.header("x-csrf-token");
    if (submitted === undefined) {
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
    }

    if (value === undefined || submitted === undefined) return forbidden();
    const expected = Buffer.from(sign(value));
    const actual = Buffer.from(submitted);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return forbidden();

    return next();
  };
}
