import { ADMIN_SESSION_HOURS } from "../../src/application/admin.ts";
import type { AdminAuth } from "../../src/application/ports.ts";

/** Accepts one token and remembers the sessions it issued, with their expiry. */
export class FakeAdminAuth implements AdminAuth {
  readonly #token: string;
  readonly #sessions = new Map<string, Date>();

  constructor(token = "fake-admin-token") {
    this.#token = token;
  }

  checkToken(candidate: string): boolean {
    return candidate === this.#token;
  }

  startSession(now: Date): { value: string; expiresAt: Date } {
    const value = `admin-session-${this.#sessions.size + 1}`;
    const expiresAt = new Date(now.getTime() + ADMIN_SESSION_HOURS * 3_600_000);
    this.#sessions.set(value, expiresAt);
    return { value, expiresAt };
  }

  hasSession(value: string, now: Date): boolean {
    const expiresAt = this.#sessions.get(value);
    return expiresAt !== undefined && expiresAt > now;
  }
}
