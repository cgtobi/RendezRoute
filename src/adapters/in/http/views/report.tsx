// Reporting a plan (spec 7 Moderation, decision I47): a reason, optional details and the recap
// posts the reporter can see, to attach as copies without their authors' names.
import type { AttachablePost } from "../../../../application/reports.ts";
import { REPORT_LIMITS, REPORT_REASONS, type ReportReason } from "../../../../domain/report.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import type { MessageKey } from "../../../i18n/messages/en.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage } from "./format.ts";
import { BackLink } from "./back-link.tsx";

export const REASON_LABELS: Readonly<Record<ReportReason, MessageKey>> = {
  spam: "report.reason.spam",
  inappropriate: "report.reason.inappropriate",
  unsafe: "report.reason.unsafe",
  other: "report.reason.other",
};

/** A recap post as plain text: its comment and its link, never a clickable link here. */
export const postText = (post: { body: string | undefined; linkUrl: string | undefined }) =>
  [post.body, post.linkUrl].filter((part) => part !== undefined).join(" · ");

export function ReportForm({
  t,
  planId,
  planTitle,
  attachable,
  csrfToken,
  nonce,
  values = { reason: "", details: "", attach: [] },
  errors = [],
}: {
  t: Translate;
  planId: string;
  planTitle: string;
  attachable: readonly AttachablePost[];
  csrfToken: string;
  /** One-time value, so sending the form twice stores one report (decision I44). */
  nonce: string;
  /** The submitted values, kept when the form shows errors. */
  values?: { reason: string; details: string; attach: readonly string[] } | undefined;
  errors?: readonly { field: string; code: string }[] | undefined;
}) {
  const errorFor = (field: string) => errors.find((e) => e.field === field);
  const reasonError = errorFor("reason");
  const detailsError = errorFor("details");
  return (
    <section class="report">
      <BackLink href={`/p/${planId}`} label={t("report.back")} />
      <h1>{t("report.heading", { title: planTitle })}</h1>
      <p>{t("report.intro")}</p>
      <form method="post" action={`/p/${planId}/report`}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <input type="hidden" name="nonce" value={nonce} />
        <fieldset class={reasonError === undefined ? undefined : "field-invalid"}>
          <legend>{t("report.reason")}</legend>
          {REPORT_REASONS.map((reason) => (
            <label class="choice">
              <input
                type="radio"
                name="reason"
                value={reason}
                checked={values.reason === reason}
                required
                aria-describedby={reasonError === undefined ? undefined : "field-reason-error"}
              />
              {t(REASON_LABELS[reason])}
            </label>
          ))}
          {reasonError !== undefined && (
            <p class="error" id="field-reason-error">
              {fieldErrorMessage(reasonError.code, t)}
            </p>
          )}
        </fieldset>
        <div class={detailsError === undefined ? "field" : "field field-invalid"}>
          <label for="field-details">{t("report.details")}</label>
          <textarea
            id="field-details"
            name="details"
            rows={4}
            maxlength={REPORT_LIMITS.details}
            aria-invalid={detailsError === undefined ? undefined : "true"}
            aria-describedby={
              detailsError === undefined ? "field-details-hint" : "field-details-error"
            }
          >
            {values.details}
          </textarea>
          <p class="hint" id="field-details-hint">
            {t("report.detailsHint")}
          </p>
          {detailsError !== undefined && (
            <p class="error" id="field-details-error">
              {fieldErrorMessage(detailsError.code, t)}
            </p>
          )}
        </div>
        {attachable.length > 0 && (
          <fieldset>
            <legend>{t("report.attach")}</legend>
            <p class="hint">{t("report.attachHint")}</p>
            {attachable.map((post) => (
              <label class="choice">
                <input
                  type="checkbox"
                  name="attach"
                  value={post.id}
                  checked={values.attach.includes(post.id)}
                />
                {postText(post)}
              </label>
            ))}
          </fieldset>
        )}
        <button type="submit">{t("report.submit")}</button>
      </form>
    </section>
  );
}

export function ReportSent({ t, planId }: { t: Translate; planId: string }) {
  return (
    <section class="report">
      <BackLink href={`/p/${planId}`} label={t("report.back")} />
      <h1>{t("report.sentTitle")}</h1>
      <p class="notice" role="status">
        {t("report.sent")}
      </p>
    </section>
  );
}
