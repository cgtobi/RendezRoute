// Voluntary application server identification for Web Push (RFC 8292): a short-lived JWT for the
// push service's origin, signed with the instance's VAPID key (spec 10).
import { createPrivateKey, sign } from "node:crypto";

export interface VapidKeys {
  /** base64url, uncompressed P-256 point (65 bytes); given to browsers as applicationServerKey. */
  publicKey: string;
  /** base64url, the private scalar (32 bytes). */
  privateKey: string;
}

/** Push services reject tokens valid for more than 24 hours. */
const LIFETIME_SECONDS = 12 * 60 * 60;

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function vapidAuthorization({
  endpoint,
  keys,
  subject,
  now,
}: {
  endpoint: URL;
  keys: VapidKeys;
  /** "mailto:" contact or an https URL of the instance. */
  subject: string;
  now: Date;
}): string {
  const header = base64url({ typ: "JWT", alg: "ES256" });
  const claims = base64url({
    aud: endpoint.origin,
    exp: Math.floor(now.getTime() / 1000) + LIFETIME_SECONDS,
    sub: subject,
  });
  const raw = Buffer.from(keys.publicKey, "base64url");
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: raw.subarray(1, 33).toString("base64url"),
      y: raw.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${signature.toString("base64url")}, k=${keys.publicKey}`;
}
