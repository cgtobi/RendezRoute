import { describe, expect, it } from "vite-plus/test";
import {
  clientKey,
  createRateLimiter,
  createReplyLimits,
} from "../../../src/adapters/in/http/rate-limit.ts";

function limiter(maxKeys = 100) {
  let now = 0;
  const limit = createRateLimiter({ capacity: 3, perHour: 6, maxKeys, now: () => now });
  return { limit, advance: (seconds: number) => (now += seconds * 1000) };
}

describe("rate limiter (decision I10)", () => {
  it("allows a burst up to the capacity, then asks to wait for the next token", () => {
    const { limit } = limiter();
    expect([1, 2, 3].map(() => limit.take("a").ok)).toEqual([true, true, true]);
    // 6 per hour: one token every 600 s.
    expect(limit.take("a")).toEqual({ ok: false, retryAfterSeconds: 600 });
  });

  it("refills over time, up to the capacity", () => {
    const { limit, advance } = limiter();
    for (let i = 0; i < 3; i++) limit.take("a");
    advance(600);
    expect(limit.take("a").ok).toBe(true);
    expect(limit.take("a").ok).toBe(false);
    advance(100_000);
    expect([1, 2, 3, 4].map(() => limit.take("a").ok)).toEqual([true, true, true, false]);
  });

  it("can check without taking, for limits that count only successes", () => {
    const { limit } = limiter();
    for (let i = 0; i < 5; i++) expect(limit.check("a").ok).toBe(true);
    for (let i = 0; i < 3; i++) limit.take("a");
    expect(limit.check("a")).toEqual({ ok: false, retryAfterSeconds: 600 });
  });

  it("gives a token back when the work it was reserved for did not happen", () => {
    const { limit } = limiter();
    for (let i = 0; i < 3; i++) limit.take("a");
    limit.refund("a");
    expect(limit.take("a").ok).toBe(true);
    expect(limit.take("a").ok).toBe(false);
    // Never above the capacity, and nothing stored for unknown clients.
    limit.refund("b");
    expect(limit.size()).toBe(1);
  });

  it("keeps clients apart", () => {
    const { limit } = limiter();
    for (let i = 0; i < 3; i++) limit.take("a");
    expect(limit.take("b").ok).toBe(true);
  });

  it("forgets clients once their bucket is full again, so addresses are kept only briefly", () => {
    const { limit, advance } = limiter();
    limit.take("a");
    advance(599);
    limit.take("b");
    expect(limit.size()).toBe(2);
    advance(1);
    limit.take("c");
    // "a" has refilled after 600 s and is forgotten; "b" still owes a token.
    expect(limit.size()).toBe(2);
    limit.check("d");
    expect(limit.size()).toBe(2);
  });

  it("forgets refilled clients on the periodic sweep, also without new requests", () => {
    const { limit, advance } = limiter();
    limit.take("a");
    advance(600);
    limit.sweep();
    expect(limit.size()).toBe(0);
  });

  it("forgets the oldest clients beyond the key limit, so memory stays bounded", () => {
    const { limit } = limiter(2);
    for (let i = 0; i < 3; i++) limit.take("a");
    limit.take("b");
    limit.take("c");
    expect(limit.size()).toBe(2);
    expect(limit.take("a").ok).toBe(true);
  });
});

describe("clientKey (decision I32)", () => {
  it("uses IPv4 addresses as they are", () => {
    expect(clientKey("203.0.113.5")).toBe("203.0.113.5");
  });

  it("groups IPv6 addresses by their /64 network, which one client usually controls", () => {
    expect(clientKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:DB8:0001:0002::")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
    expect(clientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("keeps anything else as one key", () => {
    expect(clientKey("unknown")).toBe("unknown");
  });
});

describe("reply limits (decision D45)", () => {
  it("allow a burst of 10 `Create`s from one server, then 30 an hour, and keep servers apart", () => {
    let now = 0;
    const { origin } = createReplyLimits(() => now);
    const burst = Array.from({ length: 10 }, () => origin.take("https://one.example").ok);
    expect(burst).toEqual(Array.from({ length: 10 }, () => true));
    // 30 an hour: one token every 120 s.
    expect(origin.take("https://one.example")).toEqual({ ok: false, retryAfterSeconds: 120 });
    expect(origin.take("https://two.example").ok).toBe(true);
    now += 120_000;
    expect(origin.take("https://one.example").ok).toBe(true);
    expect(origin.take("https://one.example").ok).toBe(false);
  });
});
