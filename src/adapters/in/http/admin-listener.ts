// What is different about cookies and CSRF on the admin listener (decision D55). Cookies are not
// isolated by port, so the admin listener has its own cookie names and CSRF key; the public
// port's cookies (same host, other port) never act on the admin and the other way round. The
// cookies are Secure when ADMIN_URL is an https origin (the origin rule refuses any other, so the
// browser provably arrives over https), else only when the request arrived over https, so a tunnel
// to localhost or a LAN address works; BASE_URL's https rule does not apply to this listener.
import type { Context } from "hono";
import type { Config } from "../../../config.ts";
import type { CsrfOptions } from "./csrf.ts";
import { requestIsHttps } from "./request-protocol.ts";

export const ADMIN_SESSION_COOKIE = "rr-admin-split";
export const ADMIN_CSRF_COOKIE = "rr-admin-csrf";

export const secureForRequest = (config: Config) => (c: Context) =>
  config.admin?.url?.protocol === "https:" || requestIsHttps(c, config.trustProxy);

/**
 * Who may post: the Origin must equal ADMIN_URL when that is set; otherwise its host must be the
 * Host header's and Sec-Fetch-Site must not say cross-site. Behind a proxy that rewrites Host,
 * set ADMIN_URL.
 */
export function adminOriginRule(config: Config): (c: Context, origin: string) => boolean {
  const configured = config.admin?.url?.origin;
  return (c, origin) => {
    if (configured !== undefined) return origin === configured;
    if (c.req.header("sec-fetch-site") === "cross-site") return false;
    const host = c.req.header("host");
    const originHost = URL.parse(origin)?.host;
    return host !== undefined && originHost !== undefined && originHost === host.toLowerCase();
  };
}

export function adminCsrfOptions(config: Config): Pick<CsrfOptions, "cookie" | "isOwnOrigin"> {
  return {
    cookie: { name: ADMIN_CSRF_COOKIE, sameSite: "Strict", secure: secureForRequest(config) },
    isOwnOrigin: adminOriginRule(config),
  };
}
