// Accounts (spec 7 Identity; plan v1.0 step 4a).
import { describe, expect, it } from "vite-plus/test";
import {
  displayNameFromProvider,
  loginExpired,
  LOGIN_WINDOW_MINUTES,
  validateDisplayName,
} from "../../src/domain/identity.ts";
import { postingRequirement } from "../../src/domain/invite.ts";

describe("display names (spec 7 Identity)", () => {
  it("are optional, single-line and at most 50 characters, like the poster's name", () => {
    expect(validateDisplayName("  Anna  ")).toEqual({ ok: true, value: "Anna" });
    expect(validateDisplayName("")).toEqual({ ok: true, value: undefined });
    expect(validateDisplayName("x".repeat(51))).toEqual({ ok: false, error: "too_long" });
    expect(validateDisplayName("An\nna")).toEqual({ ok: false, error: "invalid_characters" });
  });

  it("are taken from the provider when usable, and left empty otherwise", () => {
    expect(displayNameFromProvider(["Anna Example", "anna"])).toBe("Anna Example");
    expect(displayNameFromProvider([undefined, " anna "])).toBe("anna");
    expect(displayNameFromProvider(["x".repeat(51), "a\u0000b"])).toBeUndefined();
    expect(displayNameFromProvider([undefined, undefined])).toBeUndefined();
  });
});

describe("pending logins", () => {
  it("must be finished within 10 minutes", () => {
    const started = new Date("2026-06-01T08:00:00Z");
    const at = (minutes: number) => new Date(started.getTime() + minutes * 60_000);
    expect(LOGIN_WINDOW_MINUTES).toBe(10);
    expect(loginExpired(started, at(9.9))).toBe(false);
    expect(loginExpired(started, at(10))).toBe(true);
  });
});

describe("posting rules with accounts (spec 7 Moderation)", () => {
  it("need a login with POSTING_MODE=logged_in", () => {
    expect(postingRequirement("logged_in")).toBe("login");
  });
});
