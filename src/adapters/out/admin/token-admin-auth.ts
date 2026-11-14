// `ADMIN_TOKEN` authentication (spec 7 Moderation). The token is compared in constant time, also
// across lengths, by comparing SHA-256 digests. Sessions are stateless: the value holds its expiry
// and an HMAC keyed by a hash of the token, so changing the token ends every session.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ADMIN_SESSION_HOURS } from "../../../application/admin.ts";
import type { AdminAuth } from "../../../application/ports.ts";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
const SESSION = /^(\d{13})\.([A-Za-z0-9_-]{43})$/;

/**
 * `split`: the admin listener (decision D55) signs its sessions with another key, so a session
 * cookie value issued by the admin pages on the public listener (same token, other deployment
 * mode) is not valid there, and switching the mode ends every session.
 */
export function createTokenAdminAuth(
  adminToken: string,
  { split = false }: { split?: boolean } = {},
): AdminAuth {
  const expected = digest(adminToken);
  const sessionKey = digest(`rendezroute-admin${split ? "-split" : ""}|${adminToken}`);
  const sign = (expiresAt: string) =>
    createHmac("sha256", sessionKey).update(expiresAt).digest("base64url");
  return {
    checkToken(candidate) {
      return timingSafeEqual(digest(candidate), expected);
    },
    startSession(now) {
      const expiresAt = new Date(now.getTime() + ADMIN_SESSION_HOURS * 3_600_000);
      const stamp = String(expiresAt.getTime());
      return { value: `${stamp}.${sign(stamp)}`, expiresAt };
    },
    hasSession(value, now) {
      const match = SESSION.exec(value);
      if (match === null) return false;
      const [, stamp = "", given = ""] = match;
      return (
        timingSafeEqual(Buffer.from(given), Buffer.from(sign(stamp))) &&
        Number(stamp) > now.getTime()
      );
    },
  };
}
