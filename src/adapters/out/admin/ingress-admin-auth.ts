// Home Assistant Ingress as the admin's identity (decision D56). The Supervisor proxies the
// browser to the app and vouches for the user in `X-Remote-User-Groups` (sent since Supervisor
// 2026.10.4, which also strips client-sent copies in every letter case since 2026.10.3). The
// header counts only on a connection from the Supervisor's own address; any other peer can send
// anything, so for it no header is read at all. Header names live in the HTTP adapter.
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type {
  IngressAdminAuth,
  IngressDecision,
  IngressFacts,
} from "../../../application/ports.ts";

/** The group Home Assistant puts every administrator in. Compared exactly, case included. */
const ADMIN_GROUP = "system-admin";

/**
 * One spelling per address: "::ffff:a.b.c.d" is a.b.c.d (a dual-stack socket reports IPv4 peers
 * that way) and IPv6 is lower-case and compressed; anything that is no IP address stays as is
 * and so never equals a configured peer.
 */
export function canonicalAddress(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped !== undefined) return mapped;
  if (isIP(address) === 6)
    return URL.parse(`http://[${address}]`)?.hostname.slice(1, -1) ?? address;
  return address;
}

export function createIngressAdminAuth({ peer }: { peer: string }): IngressAdminAuth {
  const trusted = canonicalAddress(peer);
  const session = randomBytes(32).toString("base64url");
  return {
    session,
    check({ peer: from, groups }: IngressFacts): IngressDecision {
      if (from === undefined || isIP(from) === 0 || canonicalAddress(from) !== trusted) {
        return { kind: "denied", reason: "not_supervisor" };
      }
      const isAdmin = groups?.split(",").some((group) => group.trim() === ADMIN_GROUP) === true;
      return isAdmin ? { kind: "allowed" } : { kind: "denied", reason: "not_admin" };
    },
    checkToken() {
      return false;
    },
    startSession() {
      // Unreachable: only a successful checkToken starts a session.
      throw new Error("Ingress mode has no sessions");
    },
    hasSession(value) {
      return value === session;
    },
  };
}
