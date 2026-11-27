// Client IP for rate limiting (spec 3.8 "Proxy"). Forwarding headers count only with
// TRUST_PROXY, and then only the rightmost X-Forwarded-For entry: the one our reverse
// proxy appended. Entries to its left are client-supplied and can be forged.
// Assumes exactly one trusted proxy in front of the app (the documented Caddy setup).
// Never log the result (decision I18).
import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { MiddlewareHandler } from "hono";

export type ClientIpEnv = { Variables: { clientIp: string } };

export function resolveClientIp({
  trustProxy,
  forwardedFor,
  remoteAddress,
}: {
  trustProxy: boolean;
  forwardedFor: string | undefined;
  remoteAddress: string | undefined;
}): string {
  if (trustProxy && forwardedFor) {
    const nearest = forwardedFor.split(",").at(-1)?.trim() ?? "";
    if (isIP(nearest) !== 0) return normalize(nearest);
  }
  return remoteAddress === undefined ? "unknown" : normalize(remoteAddress);
}

/** "::ffff:203.0.113.5" → "203.0.113.5", so one client has one key with or without the proxy. */
function normalize(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  return mapped ?? address;
}

export function clientIp({
  trustProxy,
  onUntrustedForwarded,
}: {
  trustProxy: boolean;
  /** Called once, without any address, when X-Forwarded-For arrives while TRUST_PROXY is off. */
  onUntrustedForwarded?: () => void;
}): MiddlewareHandler<ClientIpEnv> {
  let reported = false;
  return async (c, next) => {
    if (!trustProxy && !reported && c.req.header("x-forwarded-for") !== undefined) {
      reported = true;
      onUntrustedForwarded?.();
    }
    let remoteAddress: string | undefined;
    try {
      remoteAddress = getConnInfo(c).remote.address;
    } catch {
      // No socket, e.g. app.request() in tests.
    }
    c.set(
      "clientIp",
      resolveClientIp({ trustProxy, forwardedFor: c.req.header("x-forwarded-for"), remoteAddress }),
    );
    await next();
  };
}
