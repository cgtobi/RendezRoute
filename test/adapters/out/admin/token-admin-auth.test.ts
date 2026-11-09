import { describe, expect, it } from "vite-plus/test";
import { createTokenAdminAuth } from "../../../../src/adapters/out/admin/token-admin-auth.ts";

describe("ADMIN_TOKEN authentication (spec 7 Moderation)", () => {
  const auth = createTokenAdminAuth("correct-horse-battery-staple-0123456789");

  it("accepts exactly the token", () => {
    expect(auth.checkToken("correct-horse-battery-staple-0123456789")).toBe(true);
  });

  it("refuses anything else, of any length", () => {
    for (const candidate of [
      "",
      "correct",
      "correct-horse-battery-staple-012345678",
      "correct-horse-battery-staple-0123456789 ",
      "x".repeat(10_000),
    ]) {
      expect(auth.checkToken(candidate)).toBe(false);
    }
  });
});

describe("ADMIN_TOKEN sessions (spec 7 Moderation, decision I46)", () => {
  const token = "correct-horse-battery-staple-0123456789";
  const now = new Date("2026-06-01T08:00:00Z");
  const hours = (n: number) => new Date(now.getTime() + n * 3_600_000);

  it("last 12 hours", () => {
    const auth = createTokenAdminAuth(token);
    const session = auth.startSession(now);
    expect(session.expiresAt).toEqual(hours(12));
    expect(auth.hasSession(session.value, hours(11.9))).toBe(true);
    expect(auth.hasSession(session.value, hours(12))).toBe(false);
  });

  it("end when the token changes", () => {
    const { value } = createTokenAdminAuth(token).startSession(now);
    expect(createTokenAdminAuth(`${token}-new`).hasSession(value, now)).toBe(false);
  });

  it("cannot be forged or extended", () => {
    const auth = createTokenAdminAuth(token);
    const { value } = auth.startSession(now);
    const [, signature] = value.split(".");
    const later = String(hours(48).getTime());
    for (const forged of [
      "",
      "x",
      `${later}.${signature}`,
      `${later}.${"A".repeat(43)}`,
      `${value}x`,
    ]) {
      expect(auth.hasSession(forged, now)).toBe(false);
    }
  });
});
