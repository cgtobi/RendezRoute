// Posting rules and invite links (spec 7 Moderation; plan v1.0 step 3).
import { describe, expect, it } from "vite-plus/test";
import {
  type Invite,
  inviteState,
  postingRequirement,
  validateInviteInput,
} from "../../src/domain/invite.ts";

const now = new Date("2026-06-01T08:00:00Z");
const invite = (overrides: Partial<Invite> = {}): Invite => ({
  id: "invite-1",
  expiresAt: undefined,
  maxUses: undefined,
  uses: 0,
  revokedAt: undefined,
  createdAt: now,
  ...overrides,
});

describe("posting rules (spec 7 Moderation)", () => {
  it("let anyone post by default, and only invited devices with POSTING_MODE=invite", () => {
    expect(postingRequirement("anyone")).toBe("none");
    expect(postingRequirement("invite")).toBe("invite");
  });
});

describe("invite state", () => {
  it("is usable without limits, however often it was used", () => {
    expect(inviteState(invite({ uses: 500 }), now)).toBe("usable");
  });

  it("expires at its expiry time", () => {
    const expiresAt = new Date(now.getTime() + 60_000);
    expect(inviteState(invite({ expiresAt }), now)).toBe("usable");
    expect(inviteState(invite({ expiresAt }), expiresAt)).toBe("expired");
  });

  it("is used up once its usage limit is reached", () => {
    expect(inviteState(invite({ maxUses: 2, uses: 1 }), now)).toBe("usable");
    expect(inviteState(invite({ maxUses: 2, uses: 2 }), now)).toBe("used_up");
  });

  it("says revoked first, whatever else applies", () => {
    const revoked = invite({ revokedAt: now, maxUses: 1, uses: 1, expiresAt: now });
    expect(inviteState(revoked, now)).toBe("revoked");
  });
});

describe("the admin's invite form", () => {
  const rules = { now, timeZone: "Europe/Berlin" };

  it("leaves expiry and usage limit open when empty", () => {
    expect(validateInviteInput({ expiresOn: "", maxUses: " " }, rules)).toEqual({
      ok: true,
      value: { expiresAt: undefined, maxUses: undefined },
    });
  });

  it("expires at the end of the chosen day in the instance's time zone", () => {
    expect(validateInviteInput({ expiresOn: "2026-06-10", maxUses: "25" }, rules)).toEqual({
      ok: true,
      value: { expiresAt: new Date("2026-06-10T22:00:00Z"), maxUses: 25 },
    });
    // Today is allowed: the day has not ended yet.
    expect(validateInviteInput({ expiresOn: "2026-06-01", maxUses: "" }, rules)).toMatchObject({
      ok: true,
    });
  });

  it("refuses past days, invalid dates and usage limits that are not whole positive numbers", () => {
    expect(validateInviteInput({ expiresOn: "2026-05-31", maxUses: "0" }, rules)).toEqual({
      ok: false,
      errors: [
        { field: "expiresOn", code: "expiry_in_past" },
        { field: "maxUses", code: "out_of_range" },
      ],
    });
    expect(validateInviteInput({ expiresOn: "2026-02-30", maxUses: "2.5" }, rules)).toEqual({
      ok: false,
      errors: [
        { field: "expiresOn", code: "date_invalid" },
        { field: "maxUses", code: "number_invalid" },
      ],
    });
    expect(validateInviteInput({ expiresOn: "", maxUses: "10001" }, rules)).toEqual({
      ok: false,
      errors: [{ field: "maxUses", code: "out_of_range" }],
    });
  });
});
