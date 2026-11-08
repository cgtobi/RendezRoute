// Web Push subscriptions (spec 6 feature 3, decision I36). Endpoints come from the browser, so
// only the browser vendors' push services are accepted: anything else would let a subscription
// point the server at an arbitrary host.
import { err, ok, type Result } from "./result.ts";

export interface PushSubscription {
  endpoint: string;
  /** base64url: the browser's P-256 public key (65 bytes) and authentication secret (16 bytes). */
  keys: { p256dh: string; auth: string };
}

const EXACT_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com"]);
const HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];
const MAX_ENDPOINT_LENGTH = 1024;

/** Browsers per response or hosted plan; a new one replaces the oldest (spec 3.11: abuse limits). */
export const MAX_CHANNELS_PER_OWNER = 5;

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    return false;
  }
  return isPushServiceHost(url.hostname);
}

/** A browser vendor's push service host (decision I36). */
export function isPushServiceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const unpadded = (value: unknown) => (typeof value === "string" ? value.replace(/=+$/, "") : "");

export function parsePushSubscription(value: unknown): Result<PushSubscription, "invalid"> {
  if (typeof value !== "object" || value === null) return err("invalid");
  const { endpoint, keys } = value as Record<string, unknown>;
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_LENGTH) return err("invalid");
  if (!isPushServiceEndpoint(endpoint)) return err("invalid");
  if (typeof keys !== "object" || keys === null) return err("invalid");
  const p256dh = unpadded((keys as Record<string, unknown>).p256dh);
  const auth = unpadded((keys as Record<string, unknown>).auth);
  // An uncompressed point starts with 0x04, which base64url encodes as "B".
  if (!/^B[A-Za-z0-9_-]{86}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth)) {
    return err("invalid");
  }
  return ok({ endpoint, keys: { p256dh, auth } });
}
