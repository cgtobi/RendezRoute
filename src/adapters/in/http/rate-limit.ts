// Rate limits (spec 5 feature 12, decisions I10, I32): in-memory token buckets per client,
// reset on restart. Keys are client IPs, IPv6 grouped by /64; they are never logged (I18).
import { isIP } from "node:net";

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Whether a token is available, without taking it. */
  check(key: string): RateLimitResult;
  /** Takes a token if one is available. */
  take(key: string): RateLimitResult;
  /** Number of tracked clients (for tests). */
  size(): number;
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

  const current = (key: string): Bucket => {
    const time = now();
    const bucket = buckets.get(key);
    // Re-inserting keeps the Map in least-recently-used order.
    buckets.delete(key);
    const refilled: Bucket =
      bucket === undefined
        ? { tokens: capacity, updatedAt: time }
        : {
            tokens: Math.min(capacity, bucket.tokens + (time - bucket.updatedAt) / msPerToken),
            updatedAt: time,
          };
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
    check: (key) => result(current(key)),
    take: (key) => {
      const bucket = current(key);
      const outcome = result(bucket);
      if (outcome.ok) bucket.tokens -= 1;
      return outcome;
    },
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
