import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
import {
  clientIp,
  type ClientIpEnv,
  resolveClientIp,
} from "../../../src/adapters/in/http/client-ip.ts";

describe("resolveClientIp (spec 3.8: forwarding headers only when TRUST_PROXY is set)", () => {
  it("ignores X-Forwarded-For unless the proxy is trusted", () => {
    expect(
      resolveClientIp({
        trustProxy: false,
        forwardedFor: "198.51.100.7",
        remoteAddress: "10.0.0.2",
      }),
    ).toBe("10.0.0.2");
  });

  it("uses the address the trusted proxy appended (rightmost), not client-supplied entries", () => {
    expect(
      resolveClientIp({
        trustProxy: true,
        forwardedFor: "1.2.3.4, 198.51.100.7",
        remoteAddress: "10.0.0.2",
      }),
    ).toBe("198.51.100.7");
    expect(
      resolveClientIp({ trustProxy: true, forwardedFor: "2001:db8::1", remoteAddress: "10.0.0.2" }),
    ).toBe("2001:db8::1");
  });

  it("falls back to the socket address when the header is missing or invalid", () => {
    for (const forwardedFor of [undefined, "", "not-an-ip", "1.2.3.4, garbage"]) {
      expect(resolveClientIp({ trustProxy: true, forwardedFor, remoteAddress: "10.0.0.2" })).toBe(
        "10.0.0.2",
      );
    }
  });

  it("normalizes IPv4-mapped IPv6 addresses to IPv4", () => {
    expect(
      resolveClientIp({
        trustProxy: false,
        forwardedFor: undefined,
        remoteAddress: "::ffff:203.0.113.5",
      }),
    ).toBe("203.0.113.5");
    expect(
      resolveClientIp({
        trustProxy: true,
        forwardedFor: "::ffff:198.51.100.7",
        remoteAddress: undefined,
      }),
    ).toBe("198.51.100.7");
  });

  it("reports 'unknown' without any address", () => {
    expect(
      resolveClientIp({ trustProxy: false, forwardedFor: undefined, remoteAddress: undefined }),
    ).toBe("unknown");
  });
});

describe("clientIp middleware", () => {
  function app(trustProxy: boolean) {
    const hono = new Hono<ClientIpEnv>();
    hono.use(clientIp({ trustProxy }));
    hono.get("/", (c) => c.text(c.get("clientIp")));
    return hono;
  }

  it("exposes the resolved address to handlers", async () => {
    const headers = { "x-forwarded-for": "198.51.100.7" };
    expect(await (await app(true).request("/", { headers })).text()).toBe("198.51.100.7");
    expect(await (await app(false).request("/", { headers })).text()).toBe("unknown");
  });
});
