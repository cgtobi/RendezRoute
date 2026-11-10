// Posting rules and invite links (spec 7 Moderation): with POSTING_MODE=invite, only devices that
// opened a valid invite link may create plans. The instance admin creates invite links, each with
// an optional expiry date and usage limit, and can revoke them.
import type { FieldError } from "./result.ts";
import { localToInstant } from "./timezone.ts";

/** Who may create plans; `logged_in` follows with accounts. */
export const POSTING_MODES = ["anyone", "invite"] as const;
export type PostingMode = (typeof POSTING_MODES)[number];

/** What a device needs before it may create plans; accounts add "login". */
export function postingRequirement(mode: PostingMode): "none" | "invite" {
  switch (mode) {
    case "anyone":
      return "none";
    case "invite":
      return "invite";
  }
}

export interface Invite {
  id: string;
  expiresAt: Date | undefined;
  maxUses: number | undefined;
  /** Devices that became allowed to post through this link. */
  uses: number;
  revokedAt: Date | undefined;
  createdAt: Date;
}

export type InviteState = "usable" | "expired" | "used_up" | "revoked";

export function inviteState(invite: Invite, now: Date): InviteState {
  if (invite.revokedAt !== undefined) return "revoked";
  if (invite.expiresAt !== undefined && invite.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  if (invite.maxUses !== undefined && invite.uses >= invite.maxUses) return "used_up";
  return "usable";
}

export const INVITE_LIMITS = {
  /** The highest usage limit one invite link can have. */
  maxUses: 10_000,
} as const;

/** The admin's invite form, as typed. */
export interface InviteInput {
  /** Optional last day, "YYYY-MM-DD". */
  expiresOn: string;
  /** Optional usage limit. */
  maxUses: string;
}

export type InviteError = FieldError<keyof InviteInput>;

/** The day after a "YYYY-MM-DD" date, as "YYYY-MM-DD". */
const dayAfter = (date: string) => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

/**
 * The admin's choices: an optional last day ("YYYY-MM-DD"; the link works until that day ends in
 * the instance's time zone) and an optional usage limit.
 */
export function validateInviteInput(
  input: InviteInput,
  rules: { now: Date; timeZone: string },
):
  | { ok: true; value: { expiresAt: Date | undefined; maxUses: number | undefined } }
  | { ok: false; errors: InviteError[] } {
  const errors: InviteError[] = [];

  let expiresAt: Date | undefined;
  const expiresOn = input.expiresOn.trim();
  if (expiresOn !== "") {
    const valid = localToInstant(expiresOn, "00:00", rules.timeZone);
    const end = valid.ok ? localToInstant(dayAfter(expiresOn), "00:00", rules.timeZone) : valid;
    if (!end.ok) errors.push({ field: "expiresOn", code: "date_invalid" });
    else if (end.value.getTime() <= rules.now.getTime()) {
      errors.push({ field: "expiresOn", code: "expiry_in_past" });
    } else expiresAt = end.value;
  }

  let maxUses: number | undefined;
  const uses = input.maxUses.trim();
  if (uses !== "") {
    if (!/^\d+$/.test(uses)) errors.push({ field: "maxUses", code: "number_invalid" });
    else if (Number(uses) < 1 || Number(uses) > INVITE_LIMITS.maxUses) {
      errors.push({ field: "maxUses", code: "out_of_range" });
    } else maxUses = Number(uses);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { expiresAt, maxUses } };
}
