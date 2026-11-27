import { describe, expect, it } from "vite-plus/test";
import {
  clientKey,
  countRefusals,
  createRateLimiter,
  createRateLimits,
  createWindowLimiter,
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

describe("coarse per-/48 bucket for costly actions", () => {
  const net = (n: number, host = 1) => clientKey(`2001:db8:1:${n.toString(16)}::${host}`);

  function coarseLimiter() {
    let now = 0;
    const limit = createRateLimiter({ capacity: 3, perHour: 6, coarse: 2, now: () => now });
    return { limit, advance: (seconds: number) => (now += seconds * 1000) };
  }

  it("shares one bucket between /64s of the same /48, not with other /48s", () => {
    const { limit } = coarseLimiter();
    // Capacity 3 x 2 = 6 for the /48: two /64s use 3 each.
    for (let i = 0; i < 3; i++) expect(limit.take(net(1)).ok).toBe(true);
    for (let i = 0; i < 3; i++) expect(limit.take(net(2)).ok).toBe(true);
    expect(limit.take(net(3)).ok).toBe(false);
    expect(limit.take(clientKey("2001:db8:2:1::1")).ok).toBe(true);
  });

  it("leaves a burst within one /64 unchanged and IPv4 on a single bucket", () => {
    const { limit } = coarseLimiter();
    expect(Array.from({ length: 3 }, () => limit.take(net(1)).ok)).toEqual([true, true, true]);
    expect(limit.take(net(1))).toEqual({ ok: false, retryAfterSeconds: 600 });
    for (let i = 0; i < 3; i++) expect(limit.take("203.0.113.5").ok).toBe(true);
    expect(limit.take("203.0.113.5").ok).toBe(false);
    expect(limit.take("203.0.113.6").ok).toBe(true);
  });

  it("refunds the fine bucket when the coarse one refuses", () => {
    const { limit } = coarseLimiter();
    for (let i = 0; i < 3; i++) limit.take(net(1));
    for (let i = 0; i < 2; i++) limit.take(net(2));
    limit.take(net(3));
    // /48 empty now; /64 number 2 still holds a token but is refused by the /48 and refunded.
    expect(limit.take(net(2)).ok).toBe(false);
    expect(limit.check(net(2)).ok).toBe(false);
    limit.refund(net(1));
    // The refund reached both buckets: the /48 has a token again, and so does /64 number 2.
    expect(limit.take(net(2)).ok).toBe(true);
    expect(limit.take(net(2)).ok).toBe(false);
  });

  it("applies the per-/48 bucket to the costly app limits", () => {
    const limits = createRateLimits(() => 0);
    // Respond: burst 30 per /64, 240 per /48.
    let granted = 0;
    for (let n = 0; n < 20; n++) {
      for (let i = 0; i < 30; i++) if (limits.respond.take(net(n)).ok) granted++;
    }
    expect(granted).toBe(240);
  });
});

describe("per-address email buckets", () => {
  it("survive more than 10,000 other keys cycling through the other limiters", () => {
    const limits = createRateLimits(() => 0);
    for (let i = 0; i < 3; i++) expect(limits.emailAddress.take("victim").ok).toBe(true);
    expect(limits.emailAddress.take("victim").ok).toBe(false);
    for (let i = 0; i < 10_500; i++) {
      const key = clientKey(`2001:db8:${i.toString(16)}::1`);
      limits.email.take(key);
      limits.create.take(key);
      limits.respond.take(key);
      limits.nearby.take(key);
    }
    expect(limits.emailAddress.take("victim").ok).toBe(false);
  });

  it("are not evicted by other addresses when the store is full; new ones are refused", () => {
    let now = 0;
    const limit = createRateLimiter({
      capacity: 3,
      perHour: 3,
      maxKeys: 5,
      whenFull: "refuse",
      now: () => now,
    });
    for (let i = 0; i < 3; i++) limit.take("victim");
    for (let i = 0; i < 4; i++) limit.take(`other${i}`);
    expect(limit.take("late")).toEqual({ ok: false, retryAfterSeconds: 1200 });
    expect(limit.take("victim").ok).toBe(false);
    expect(limit.size()).toBe(5);
    // Once buckets refill, they are forgotten and room is made.
    now += 3_600_000;
    expect(limit.take("late").ok).toBe(true);
  });
});

describe("every limiter keyed by a client address has the coarse per-/48 bucket (0.19.0)", () => {
  // The burst of each limiter keyed by a client address.
  const byClient = {
    create: 5,
    respond: 30,
    geocode: 10,
    preview: 10,
    route: 10,
    notify: 10,
    calendar: 5,
    recap: 10,
    adminLogin: 5,
    report: 3,
    login: 10,
    email: 5,
    nearby: 20,
    inbox: 120,
    noteRoute: 20,
    profile: 5,
    fediverseMessages: 5,
  } as const;
  // Keyed by something else: an address's hash, a plan id, an account id.
  const byOtherKey = ["emailAddress", "emailAddressDay", "reportPlan", "fediverseMessagesAccount"];

  it("classifies every limiter, so a new one has to be put in one of the two lists", () => {
    const all = Object.keys(createRateLimits(() => 0)).toSorted();
    expect(all).toEqual([...Object.keys(byClient), ...byOtherKey].toSorted());
  });

  it.each(Object.entries(byClient))(
    "%s: one /48 holds 8 times the burst however many /64s it spreads over",
    (name, burst) => {
      const limits = createRateLimits(() => 0) as unknown as Record<
        string,
        ReturnType<typeof createRateLimiter>
      >;
      const limit = limits[name];
      if (limit === undefined) throw new Error(`no limiter ${name}`);
      const network = (i: number) => `2001:db8:1:${i.toString(16)}::/64`;
      for (let i = 0; i < burst * 8; i++) expect(limit.take(network(i)).ok).toBe(true);
      expect(limit.take(network(burst * 8)).ok).toBe(false);
      // Another /48 is a different network.
      expect(limit.take("2001:db8:2:0::/64").ok).toBe(true);
    },
  );
});

describe("window limiter (6 in any rolling 24 hours)", () => {
  const HOUR = 3_600_000;
  function windowed(maxKeys = 100) {
    let now = 0;
    const limit = createWindowLimiter({
      capacity: 6,
      windowMs: 24 * HOUR,
      maxKeys,
      now: () => now,
    });
    return { limit, advance: (ms: number) => (now += ms) };
  }

  it("never allows more than 6 in any 24 hours, however they are spread", () => {
    const { limit, advance } = windowed();
    expect(limit.take("a").ok).toBe(true);
    advance(5 * HOUR);
    for (let i = 0; i < 5; i++) expect(limit.take("a").ok).toBe(true);
    // 6 within the window; a bucket refilling 6 a day would have allowed more by now.
    advance(18 * HOUR);
    expect(limit.take("a")).toEqual({ ok: false, retryAfterSeconds: 3600 });
    advance(HOUR);
    expect(limit.take("a").ok).toBe(true);
    expect(limit.take("a")).toEqual({ ok: false, retryAfterSeconds: 5 * 3600 });
  });

  it("checks without taking, and refunds the latest take", () => {
    const { limit } = windowed();
    for (let i = 0; i < 6; i++) limit.take("a");
    expect(limit.check("a").ok).toBe(false);
    limit.refund("a");
    expect(limit.check("a").ok).toBe(true);
    expect(limit.take("a").ok).toBe(true);
    expect(limit.take("a").ok).toBe(false);
  });

  it("forgets keys once their window has passed, and refuses new ones when full", () => {
    const { limit, advance } = windowed(2);
    limit.take("a");
    limit.take("b");
    expect(limit.take("c").ok).toBe(false);
    expect(limit.take("a").ok).toBe(true);
    advance(25 * HOUR);
    limit.sweep();
    expect(limit.size()).toBe(0);
    expect(limit.take("c").ok).toBe(true);
  });
});

describe("countRefusals (hourly summary)", () => {
  it("tells about every refused take and nothing else", () => {
    let refused = 0;
    const limits = countRefusals(
      createRateLimits(() => 0),
      () => {
        refused += 1;
      },
    );
    for (let i = 0; i < 5; i++) limits.create.take("k");
    expect(refused).toBe(0);
    limits.create.take("k");
    expect(refused).toBe(1);
    expect(limits.create.check("k").ok).toBe(false);
    expect(refused).toBe(1);
  });
});
