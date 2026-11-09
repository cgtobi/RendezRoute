// Reports to the instance admin (spec 7 Moderation, decisions D22, I47): a reason, optional details and
// copies of recap posts the reporter chose to attach, without their authors' names. A report does
// not record who sent it, and goes with its plan.
import type { FieldError } from "./result.ts";
import { cleanText } from "./text.ts";

export const REPORT_REASONS = ["spam", "inappropriate", "unsafe", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_LIMITS = {
  /** Characters of the reporter's details. */
  details: 1000,
} as const;

/** A copy of a recap post as it was when reported; no author. */
export interface AttachedContribution {
  body: string | undefined;
  linkUrl: string | undefined;
}

/** The copy of a post that a report keeps: its comment and link, nothing else. */
export const copyOfPost = ({ body, linkUrl }: AttachedContribution): AttachedContribution => ({
  body,
  linkUrl,
});

export interface Report {
  id: string;
  planId: string;
  reason: ReportReason;
  details: string | undefined;
  attached: AttachedContribution[];
  createdAt: Date;
  resolvedAt: Date | undefined;
}

export type ReportError = FieldError<"reason" | "details">;

export function validateReport(input: {
  reason: string;
  details: string;
}):
  | { ok: true; value: { reason: ReportReason; details: string | undefined } }
  | { ok: false; errors: ReportError[] } {
  const errors: ReportError[] = [];
  const reason = (REPORT_REASONS as readonly string[]).includes(input.reason)
    ? (input.reason as ReportReason)
    : undefined;
  if (reason === undefined) errors.push({ field: "reason", code: "choice_invalid" });
  const details = cleanText(input.details, { max: REPORT_LIMITS.details, multiline: true });
  if (!details.ok) errors.push({ field: "details", code: details.error });
  return errors.length > 0 || reason === undefined || !details.ok
    ? { ok: false, errors }
    : { ok: true, value: { reason, details: details.value } };
}
