// The recap (spec 6 features 5–7, decision I42): a window after the start in which participants
// and the host add comments and links, visible only to them.
import type { PlanStatus } from "./plan.ts";
import { type RecapWindow, RECAP_WINDOWS, recapWindowDays } from "./schedule.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A comment and/or link in the recap; the host's has no response. */
export interface RecapContribution {
  id: string;
  planId: string;
  /** Undefined for the host's contributions. */
  responseId: string | undefined;
  body: string | undefined;
  linkUrl: string | undefined;
  /** Hidden by the host: shown only to the host and its author (decision I42). */
  hiddenByHost: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Decision I42. */
export const CONTRIBUTION_LIMITS = {
  /** Characters of a comment. */
  body: 1000,
  /** Characters of a link. */
  linkUrl: 2000,
  /** Contributions per person and plan. */
  perPerson: 20,
} as const;

export interface RecapTiming {
  startsAt: Date;
  recapWindow: RecapWindow;
  /** Set when the window was changed after the start; it is then measured from this moment. */
  recapWindowSetAt: Date | undefined;
  /** Set when the host closed the recap after the start ("now"). */
  recapClosedAt: Date | undefined;
  deleteAt: Date;
}

/** When the recap stops taking contributions; existing ones stay visible (spec 6 feature 6). */
export function recapClosesAt(plan: RecapTiming): Date {
  const closes =
    plan.recapClosedAt?.getTime() ??
    (plan.recapWindowSetAt ?? plan.startsAt).getTime() + recapWindowDays[plan.recapWindow] * DAY_MS;
  return new Date(Math.min(closes, plan.deleteAt.getTime()));
}

/** Who writes in or looks at a recap: the host, or a participant with their response. */
export type RecapAuthor = { kind: "host" } | { kind: "participant"; responseId: string };

/** An active plan has a recap from its start on; a cancelled one never does (spec 6 feature 5). */
export function hasRecap(plan: { startsAt: Date; status: PlanStatus }, now: Date): boolean {
  return plan.status === "active" && now.getTime() >= plan.startsAt.getTime();
}

/** Contributions are taken from the start until the window closes, never for cancelled plans. */
/** A plan's recap timing with its status, as the recap and rating rules need it. */
export type RecapState = RecapTiming & { status: PlanStatus };

export function isRecapOpen(plan: RecapState, now: Date): boolean {
  return hasRecap(plan, now) && now.getTime() < recapClosesAt(plan).getTime();
}

/**
 * A new recap window. Before the start it is measured from the start; after the start from now,
 * and "now" closes the recap at once. An unchanged window keeps its timing.
 */
export function changeRecapWindow(
  plan: RecapTiming,
  recapWindow: RecapWindow,
  now: Date,
): Pick<RecapTiming, "recapWindow" | "recapWindowSetAt" | "recapClosedAt"> {
  if (recapWindow === plan.recapWindow) {
    return {
      recapWindow,
      recapWindowSetAt: plan.recapWindowSetAt,
      recapClosedAt: plan.recapClosedAt,
    };
  }
  if (now.getTime() < plan.startsAt.getTime()) {
    return { recapWindow, recapWindowSetAt: undefined, recapClosedAt: undefined };
  }
  return {
    recapWindow,
    recapWindowSetAt: now,
    recapClosedAt: recapWindow === "now" ? now : undefined,
  };
}

/**
 * The stored window if it is shorter than the one chosen in the form, so the form can say so
 * (spec 3.10); an empty choice takes the default, which always fits.
 */
export function shortenedRecapWindow(chosen: string, stored: RecapWindow): RecapWindow | undefined {
  return chosen.trim() === "" || chosen.trim() === stored ? undefined : stored;
}

/** The window, shortened to the largest that fits the retention (decision D4: never lengthened). */
export function fitRecapWindow(recapWindow: RecapWindow, retentionDays: number): RecapWindow {
  const fitting = RECAP_WINDOWS.filter(
    (window) =>
      recapWindowDays[window] <= retentionDays &&
      recapWindowDays[window] <= recapWindowDays[recapWindow],
  );
  return fitting.at(-1) ?? "now";
}

export interface ContributionError {
  field: "body" | "linkUrl";
  code: "contribution_empty" | "contribution_too_long" | "link_invalid" | "link_too_long";
}

/** A comment, a link or both; links must be http(s) web addresses (spec 3.8). */
export function validateContribution(input: {
  body: string;
  linkUrl: string;
}):
  | { ok: true; value: { body: string | undefined; linkUrl: string | undefined } }
  | { ok: false; errors: ContributionError[] } {
  const body = input.body.trim() || undefined;
  const linkUrl = input.linkUrl.trim() || undefined;
  if (body === undefined && linkUrl === undefined) {
    return { ok: false, errors: [{ field: "body", code: "contribution_empty" }] };
  }
  const errors: ContributionError[] = [];
  if (body !== undefined && Array.from(body).length > CONTRIBUTION_LIMITS.body) {
    errors.push({ field: "body", code: "contribution_too_long" });
  }
  if (linkUrl !== undefined) {
    const parsed = URL.parse(linkUrl);
    if (linkUrl.length > CONTRIBUTION_LIMITS.linkUrl) {
      errors.push({ field: "linkUrl", code: "link_too_long" });
    } else if (
      parsed === null ||
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.hostname === ""
    ) {
      errors.push({ field: "linkUrl", code: "link_invalid" });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { body, linkUrl } };
}
