// Rate limits (spec 5 feature 12, decisions I10, I32): in-memory token buckets per client,
// reset on restart. Keys are client IPs, IPv6 grouped by /64; they are never logged (I18).
import { isIP } from "node:net";

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Whether a token is available, without taking it. */
  check(key: string): RateLimitResult;
  /** Takes a token if one is available. */
  take(key: string): RateLimitResult;
  /** Gives back a token taken for work that did not happen, up to the capacity. */
  refund(key: string): void;
  /** Forgets clients whose buckets are full again; run every minute so idle addresses go too. */
  sweep(): void;
  /** Number of tracked clients (for tests). */
  size(): number;
}

/** Per-client limits of the app (spec 5 feature 12, decision I32). */
export interface RateLimits {
  create: RateLimiter;
  respond: RateLimiter;
  geocode: RateLimiter;
  preview: RateLimiter;
  route: RateLimiter;
  /** Turning notifications on (spec 3.11: limits on notification spam). */
  notify: RateLimiter;
  /** Creating calendar feed links (spec 6 feature 2). */
  calendar: RateLimiter;
  /** Adding recap contributions (spec 3.11: abuse limits). */
  recap: RateLimiter;
  /** Instance admin login attempts, against guessing ADMIN_TOKEN (spec 7 Moderation). */
  adminLogin: RateLimiter;
  /** Reports to the instance admin (spec 3.11: rate limits on reports). */
  report: RateLimiter;
}

/**
 * Creating plans and responding reserve a token before any work and give it back when nothing was
 * created, so parallel requests cannot exceed the burst. Requests carrying a route file always
 * count (parsing is the costly part), as does every place search; previews count only renders.
 * Switching to joined or requested on the manage page counts as responding, since it notifies the
 * host; every attempt to turn notifications on counts too, and every created calendar link, recap
 * contribution and report.
 * A client is forgotten once its bucket is full again, after at most 30 minutes (create: 5
 * tokens at 10 per hour).
 */
export function createRateLimits(now: () => number): RateLimits {
  return {
    create: createRateLimiter({ capacity: 5, perHour: 10, now }),
    respond: createRateLimiter({ capacity: 10, perHour: 30, now }),
    geocode: createRateLimiter({ capacity: 10, perHour: 600, now }),
    preview: createRateLimiter({ capacity: 10, perHour: 60, now }),
    route: createRateLimiter({ capacity: 10, perHour: 30, now }),
    notify: createRateLimiter({ capacity: 10, perHour: 30, now }),
    calendar: createRateLimiter({ capacity: 5, perHour: 10, now }),
    recap: createRateLimiter({ capacity: 10, perHour: 30, now }),
    adminLogin: createRateLimiter({ capacity: 5, perHour: 10, now }),
    report: createRateLimiter({ capacity: 3, perHour: 10, now }),
  };
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function createRateLimiter({
  capacity,
  perHour,
  maxKeys = 10_000,
  now,
}: {
  /** Burst size. */
  capacity: number;
  /** Refill rate. */
  perHour: number;
  /** Beyond this, the least recently used clients are forgotten (they start with a full bucket). */
  maxKeys?: number;
  now: () => number;
}): RateLimiter {
  const buckets = new Map<string, Bucket>();
  const msPerToken = 3_600_000 / perHour;

  const refill = (bucket: Bucket, time: number): Bucket => ({
    tokens: Math.min(capacity, bucket.tokens + (time - bucket.updatedAt) / msPerToken),
    updatedAt: time,
  });

  /** Drops the least recently used clients whose buckets are full again: they are like new ones. */
  const forgetRefilled = (time: number) => {
    for (const [key, bucket] of buckets) {
      if (refill(bucket, time).tokens < capacity) break;
      buckets.delete(key);
    }
  };

  /** The client's bucket refilled to now, without storing it (a new client stays untracked). */
  const peek = (key: string, time: number): Bucket => {
    const bucket = buckets.get(key);
    return bucket === undefined ? { tokens: capacity, updatedAt: time } : refill(bucket, time);
  };

  /** The client's bucket refilled to now, stored as the most recently used. */
  const touch = (key: string, time: number): Bucket => {
    const refilled = peek(key, time);
    // Re-inserting keeps the Map in least-recently-used order.
    buckets.delete(key);
    buckets.set(key, refilled);
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
    return refilled;
  };

  const result = (bucket: Bucket): RateLimitResult =>
    bucket.tokens >= 1
      ? { ok: true }
      : { ok: false, retryAfterSeconds: Math.ceil(((1 - bucket.tokens) * msPerToken) / 1000) };

  return {
    check: (key) => {
      const time = now();
      forgetRefilled(time);
      return result(peek(key, time));
    },
    take: (key) => {
      const time = now();
      forgetRefilled(time);
      const bucket = touch(key, time);
      const outcome = result(bucket);
      if (outcome.ok) bucket.tokens -= 1;
      return outcome;
    },
    refund: (key) => {
      const bucket = buckets.get(key);
      if (bucket !== undefined) bucket.tokens = Math.min(capacity, bucket.tokens + 1);
    },
    sweep: () => forgetRefilled(now()),
    size: () => buckets.size,
  };
}

/** IPv4 as is; IPv6 by its /64 network, since one client usually has a whole /64. */
export function clientKey(ip: string): string {
  const address = ip.split("%")[0] ?? ip;
  if (isIP(address) !== 6) return ip;
  const [head = "", tail] = address.toLowerCase().split("::");
  const groups = head === "" ? [] : head.split(":");
  if (tail !== undefined) {
    const tailGroups = tail === "" ? [] : tail.split(":");
    // An embedded IPv4 tail ("::ffff:1.2.3.4") counts as two groups.
    const tailLength = tailGroups.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0);
    groups.push(...Array<string>(8 - groups.length - tailLength).fill("0"));
  }
  const prefix = groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}
