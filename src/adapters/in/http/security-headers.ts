import type { MiddlewareHandler } from "hono";
import type { Config } from "../../../config.ts";

/** Security headers from spec 3.8 on every response, including 404 and error responses. */
export function securityHeaders(
  config: Config,
  /**
   * Who may frame the pages: nobody, except that the admin listener behind Home Assistant Ingress
   * is framed by the Home Assistant frontend, which is same-origin with it (decision D56).
   */
  frameAncestors: "'none'" | "'self'" = "'none'",
): MiddlewareHandler {
  const imgSources = [
    "'self'",
    "data:",
    ...(config.maps.enabled ? [config.maps.tileCspSource] : []),
  ];
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    `img-src ${imgSources.join(" ")}`,
    "connect-src 'self'",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const hsts = config.baseUrl.protocol === "https:";

  return async (c, next) => {
    await next();
    if (hsts) c.res.headers.set("strict-transport-security", "max-age=31536000");
    // Pages are per-viewer; a route that sets its own cache-control keeps it.
    if (
      !c.res.headers.has("cache-control") &&
      (c.res.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")
    )
      c.res.headers.set("cache-control", "private, no-cache");
    c.res.headers.set("content-security-policy", csp);
    c.res.headers.set("x-content-type-options", "nosniff");
    // Secret-link responses set the stricter no-referrer themselves (spec 3.2).
    if (!c.res.headers.has("referrer-policy"))
      c.res.headers.set("referrer-policy", "strict-origin");
  };
}
