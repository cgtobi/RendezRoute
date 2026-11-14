// Whether a request arrived over https, for the Secure flag of the admin listener's cookies
// (decision D55). The Node server itself only sees the proxy's plain connection, so the proxy's
// X-Forwarded-Proto counts, but only with TRUST_PROXY and, like client-ip.ts, only its rightmost
// entry: the one our reverse proxy appended; entries to its left are client-supplied. Without
// TRUST_PROXY, or without the header, the scheme of the request URL decides ("http" for the
// Node server, so a tunnel to localhost or a LAN address works).
import type { Context } from "hono";

export function requestIsHttps(c: Context, trustProxy: boolean): boolean {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-proto")?.split(",").at(-1)?.trim().toLowerCase();
    if (forwarded === "https") return true;
    if (forwarded === "http") return false;
  }
  return new URL(c.req.url).protocol === "https:";
}
