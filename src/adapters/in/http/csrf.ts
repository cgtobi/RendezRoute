// CSRF protection (spec 3.8, decision I8): signed double-submit token plus origin check.
// The cookie holds only a random value, is session-scoped and is set only when a page
// renders a form. The token in the form is HMAC(key, cookie value).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";

export type CsrfEnv = { Variables: { csrfToken: () => string } };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);
const COOKIE_VALUE = /^[A-Za-z0-9_-]{43}$/;
export const CSRF_FIELD = "_csrf";

export function csrf({
  key,
  config,
  exemptPaths = [],
}: {
  key: Buffer;
  config: Config;
  /** e.g. the signature-verified ActivityPub inbox (v1.0). */
  exemptPaths?: readonly string[];
}): MiddlewareHandler<CsrfEnv> {
  const cookieName = config.allowInsecureDev ? "rr-csrf" : "__Host-rr-csrf";
  const sign = (value: string) => createHmac("sha256", key).update(value).digest("base64url");

  return async (c, next) => {
    let value = getCookie(c, cookieName);
    if (value !== undefined && !COOKIE_VALUE.test(value)) value = undefined;

    c.set("csrfToken", () => {
      if (value === undefined) {
        value = randomBytes(32).toString("base64url");
        setCookie(c, cookieName, value, {
          httpOnly: true,
          secure: !config.allowInsecureDev,
          sameSite: "Lax",
          path: "/",
        });
      }
      return sign(value);
    });

    if (SAFE_METHODS.has(c.req.method) || exemptPaths.includes(c.req.path)) return next();

    const forbidden = () =>
      c.text("Invalid or missing security token. Reload the page and try again.", 403);

    const origin = c.req.header("origin");
    const fetchSite = c.req.header("sec-fetch-site");
    if (
      origin !== undefined
        ? origin !== config.baseUrl.origin
        : fetchSite !== undefined && !ALLOWED_FETCH_SITES.has(fetchSite)
    ) {
      return forbidden();
    }

    let submitted = c.req.header("x-csrf-token");
    if (submitted === undefined) {
      const type = c.req.header("content-type") ?? "";
      if (
        type.startsWith("application/x-www-form-urlencoded") ||
        type.startsWith("multipart/form-data")
      ) {
        const field = (await c.req.parseBody())[CSRF_FIELD];
        if (typeof field === "string") submitted = field;
      }
    }

    if (value === undefined || submitted === undefined) return forbidden();
    const expected = Buffer.from(sign(value));
    const actual = Buffer.from(submitted);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return forbidden();

    return next();
  };
}
