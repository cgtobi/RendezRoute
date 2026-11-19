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
  /** Starting a login: each start keeps a pending login and calls the provider (spec 3.11). */
  login: RateLimiter;
  /** Sending a confirmation link to an email address, per client (decision D31). */
  email: RateLimiter;
  /** The same, per address, whoever types it: no flooding someone's mailbox (spec 3.11). */
  emailAddress: RateLimiter;
  /** Nearby searches, against scraping public plans (spec 3.11, 7 Nearby). */
  nearby: RateLimiter;
  /** Posts to the inboxes, per server address (spec 3.11: inbox rate limits). */
  inbox: RateLimiter;
  /** A private Note's GPX link, public by its secret token: every try counts (decision D43). */
  noteRoute: RateLimiter;
  /** Turning a fediverse profile on, which makes signing keys (decision D36). */
  profile: RateLimiter;
  /** Switching fediverse messages on, which looks the account's address up (decision D47). */
  fediverseMessages: RateLimiter;
  /** The same per account, whatever client it comes from, keyed by its id: 3, then 6 an hour. */
  fediverseMessagesAccount: RateLimiter;
}

/**
 * Costly actions (plans, responses, confirmation emails, Nearby, place search) also take from a
 * per-/48 bucket for IPv6 clients, with 8 times the burst and refill of the per-/64 bucket. A /48
 * is what ISPs and tunnel brokers hand out for free: without this, one holder of a /48 has 65,536
 * /64 buckets, multiplying every per-client limit. 8 /64s' worth leaves room for several
 * households, a small office or a carrier-grade NAT sharing a /48, yet caps an attacker at 8x one
 * client. IPv4 stays a single per-address bucket.
 */
const COARSE_FACTOR = 8;

/** Bound on the per-address email buckets (see `emailAddress`). */
const EMAIL_ADDRESS_MAX_KEYS = 100_000;

/**
 * Creating plans and responding reserve a token before any work and give it back when nothing was
 * created, so parallel requests cannot exceed the burst. Requests carrying a route file always
 * count (parsing is the costly part), as does every place search; previews count only renders.
 * Switching to joined or requested on the manage page counts as responding, since it notifies the
 * host; every attempt to turn notifications on counts too, and every created calendar link, recap
 * contribution and report, and every confirmation link asked for, per client and per address;
 * turning a fediverse profile on counts only when it made keys, and turning fediverse messages
 * on counts when it looked an address up (D47).
 * A client is forgotten once its bucket is full again, after at most an hour (an address asking
 * for confirmation links: 3 tokens at 3 per hour).
 */
export function createRateLimits(now: () => number): RateLimits {
  return {
    create: createRateLimiter({ capacity: 5, perHour: 10, coarse: COARSE_FACTOR, now }),
    respond: createRateLimiter({ capacity: 10, perHour: 30, coarse: COARSE_FACTOR, now }),
    geocode: createRateLimiter({ capacity: 10, perHour: 600, coarse: COARSE_FACTOR, now }),
    preview: createRateLimiter({ capacity: 10, perHour: 60, now }),
    route: createRateLimiter({ capacity: 10, perHour: 30, now }),
    notify: createRateLimiter({ capacity: 10, perHour: 30, now }),
    calendar: createRateLimiter({ capacity: 5, perHour: 10, now }),
    recap: createRateLimiter({ capacity: 10, perHour: 30, now }),
    adminLogin: createRateLimiter({ capacity: 5, perHour: 10, now }),
    report: createRateLimiter({ capacity: 3, perHour: 10, now }),
    login: createRateLimiter({ capacity: 10, perHour: 30, now }),
    email: createRateLimiter({ capacity: 5, perHour: 10, coarse: COARSE_FACTOR, now }),
    // Never evicts a live address to make room: a full store refuses new addresses instead, so
    // cycling other keys cannot reopen the cap. Memory: at most EMAIL_ADDRESS_MAX_KEYS entries
    // (64-char hash key plus a bucket, roughly 200 bytes each: about 20 MB at most).
    emailAddress: createRateLimiter({
      capacity: 3,
      perHour: 3,
      maxKeys: EMAIL_ADDRESS_MAX_KEYS,
      whenFull: "refuse",
      now,
    }),
    // Searches against scraping (spec 3.11); changing a filter is a new search.
    nearby: createRateLimiter({ capacity: 20, perHour: 120, coarse: COARSE_FACTOR, now }),
    // Posts from fediverse servers: a busy server delivers in bursts.
    inbox: createRateLimiter({ capacity: 120, perHour: 3600, now }),
    noteRoute: createRateLimiter({ capacity: 20, perHour: 120, now }),
    profile: createRateLimiter({ capacity: 5, perHour: 10, now }),
    fediverseMessages: createRateLimiter({ capacity: 5, perHour: 10, now }),
    fediverseMessagesAccount: createRateLimiter({ capacity: 3, perHour: 6, now }),
  };
}

/** Limits on remote `Join`s (decision D42, spec 3.11); keys are kept in memory only. */
export interface JoinLimits {
  /** Per remote server, as strict as responding on the web (I32). */
  origin: RateLimiter;
  /** Per plan, actor and kind of response: a flip between answers is news once an hour. */
  notifyActor: RateLimiter;
  /** Per plan: the host hears of at most this many joins an hour, whatever servers they come from. */
  notifyPlan: RateLimiter;
}

/** Notices to one plan's host an hour, however many servers (or subdomains) joins come from. */
export const PLAN_NOTICES_PER_HOUR = 20;

export function createJoinLimits(now: () => number): JoinLimits {
  return {
    origin: createRateLimiter({ capacity: 10, perHour: 30, now }),
    notifyActor: createRateLimiter({ capacity: 1, perHour: 1, now }),
    notifyPlan: createRateLimiter({
      capacity: PLAN_NOTICES_PER_HOUR,
      perHour: PLAN_NOTICES_PER_HOUR,
      now,
    }),
  };
}

/** Limits on replies from remote participants (decision D45, spec 3.11); kept in memory only. */
export interface ReplyLimits {
  /**
   * Per remote server, keyed by the signer's origin, as strict as joins: burst 10, then 30 an
   * hour. A `Create` or `Update` of a `Note` takes a token only when it could count: its sender
   * has joined, it answers one of our plans or Notes and everything else checked passes, so
   * notes that are not for us cannot lock out a server's real replies. A `Note` that is only
   * named takes its token before it is fetched, so a joined actor cannot spend our fetches.
   */
  origin: RateLimiter;
}

export function createReplyLimits(now: () => number): ReplyLimits {
  return { origin: createRateLimiter({ capacity: 10, perHour: 30, now }) };
}

/** Limits on incoming `Flag`s (decision D46, spec 3.11); keys are kept in memory only. */
export interface FlagLimits {
  /**
   * Per remote server, keyed by the signer's origin: burst 5, then 10 an hour. Taken only for a
   * `Flag` that could become a report (reporting is on and it names a plan we would show), so
   * `Flag`s that name nothing of ours cannot lock out a server's real ones.
   */
  origin: RateLimiter;
  /** Per plan, whatever servers the `Flag`s come from: 10 an hour. */
  plan: RateLimiter;
}

export function createFlagLimits(now: () => number): FlagLimits {
  return {
    origin: createRateLimiter({ capacity: 5, perHour: 10, now }),
    plan: createRateLimiter({ capacity: 10, perHour: 10, now }),
  };
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

function createBucketStore({
  capacity,
  perHour,
  maxKeys = 10_000,
  whenFull = "evict",
  now,
}: {
  /** Burst size. */
  capacity: number;
  /** Refill rate. */
  perHour: number;
  /** Beyond this, the least recently used clients are forgotten (they start with a full bucket). */
  maxKeys?: number;
  /** "refuse" turns new clients away when full (after dropping refilled ones) instead of evicting. */
  whenFull?: "evict" | "refuse";
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
      if (whenFull === "refuse" && !buckets.has(key) && buckets.size >= maxKeys) {
        return { ok: false, retryAfterSeconds: Math.ceil(msPerToken / 1000) };
      }
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

export function createRateLimiter({
  capacity,
  perHour,
  coarse,
  ...rest
}: {
  /** Burst size. */
  capacity: number;
  /** Refill rate. */
  perHour: number;
  /** Beyond this, the least recently used clients are forgotten (they start with a full bucket). */
  maxKeys?: number;
  whenFull?: "evict" | "refuse";
  /**
   * For IPv6 client keys ("a:b:c:d::/64"): also take from a bucket per /48 with this many times the
   * capacity and refill. Other keys are unaffected.
   */
  coarse?: number;
  now: () => number;
}): RateLimiter {
  const fine = createBucketStore({ capacity, perHour, ...rest });
  if (coarse === undefined) return fine;
  const wide = createBucketStore({
    capacity: capacity * coarse,
    perHour: perHour * coarse,
    ...rest,
  });
  return {
    check: (key) => {
      const own = fine.check(key);
      const net = coarseKey(key);
      if (!own.ok || net === undefined) return own;
      return wide.check(net);
    },
    take: (key) => {
      const own = fine.take(key);
      const net = coarseKey(key);
      if (!own.ok || net === undefined) return own;
      const outer = wide.take(net);
      if (!outer.ok) fine.refund(key);
      return outer;
    },
    refund: (key) => {
      fine.refund(key);
      const net = coarseKey(key);
      if (net !== undefined) wide.refund(net);
    },
    sweep: () => {
      fine.sweep();
      wide.sweep();
    },
    size: () => fine.size() + wide.size(),
  };
}

/** The /48 key of a /64 client key, or undefined for IPv4 and anything else. */
function coarseKey(key: string): string | undefined {
  const match = /^([0-9a-f]+:[0-9a-f]+:[0-9a-f]+):[0-9a-f]+::\/64$/.exec(key);
  return match === null ? undefined : `${match[1]}::/48`;
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
