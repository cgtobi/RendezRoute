// Repeatable templates (spec 3.10 Templates, decision I43): the options on the plan forms, the
// list on the home page, the template page with "Repeat", and the page showing a new template link.
import type { PostingNeed } from "../../../../application/posting-rules.ts";
import type { TemplateSummary } from "../../../../application/templates.ts";
import { PostingClosed } from "./posting.tsx";
import type { Translate } from "../../../i18n/i18n.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import type { PlanTemplate, TemplateAdjustment } from "../../../../domain/template.ts";
import type { Units } from "../../../../domain/units.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, formatDate } from "./format.ts";
import { Item } from "./item.tsx";
import { LinkTools } from "./link-tools.tsx";
import { PlanMetrics } from "./plan-metrics.tsx";
import { WINDOW_LABELS } from "./recap.tsx";

/** "Keep as repeatable template" and its sub-option, on the create and host forms. */
export function TemplateOptions({
  t,
  values,
  errors,
}: {
  t: Translate;
  values: Pick<PlanInput, "keepAsTemplate" | "templateIncludePrivate">;
  errors: readonly FieldError[];
}) {
  const error = errors.find(
    (e) => e.field === "keepAsTemplate" || e.field === "templateIncludePrivate",
  );
  return (
    <fieldset class={error === undefined ? undefined : "field-invalid"}>
      <legend>{t("form.template")}</legend>
      <label class="choice">
        <input
          type="checkbox"
          name="keepAsTemplate"
          value="1"
          checked={values.keepAsTemplate === "1"}
        />
        {t("form.keepAsTemplate")}
      </label>
      <label class="choice">
        <input
          type="checkbox"
          name="templateIncludePrivate"
          value="1"
          checked={values.templateIncludePrivate === "1"}
        />
        {t("form.templateIncludePrivate")}
      </label>
      <p class="hint">{t("form.templateHint")}</p>
      {error !== undefined && <p class="error">{fieldErrorMessage(error.code, t)}</p>}
    </fieldset>
  );
}

/** "Your templates" on the home page, for the devices linked to them: what, when and where. */
export function TemplateList({
  t,
  templates,
}: {
  t: Translate;
  templates: readonly TemplateSummary[];
}) {
  if (templates.length === 0) return null;
  return (
    <section class="templates">
      <h2>{t("home.templates")}</h2>
      <ul class="items">
        {templates.map((template) => (
          <Item
            href={`/templates/${template.id}`}
            title={template.title}
            meta={[
              t(`activity.${template.activity}`),
              `${template.startTime} (${template.timeZone})`,
              template.area.label,
            ].join(" · ")}
          />
        ))}
      </ul>
    </section>
  );
}

/** What a repeat changed to meet the current rules (spec 3.10: the host is told). */
export function TemplateAdjustments({
  t,
  adjustments,
}: {
  t: Translate;
  adjustments: readonly TemplateAdjustment[];
}) {
  if (adjustments.length === 0) return null;
  return (
    <div class="notice" role="status">
      <p>{t("template.adjusted")}</p>
      <ul>
        {adjustments.map((adjustment) => (
          <li>
            {adjustment.field === "retentionDays"
              ? t("template.adjustedRetention", { count: adjustment.to, from: adjustment.from })
              : t("template.adjustedRecapWindow", {
                  from: t(WINDOW_LABELS[adjustment.from]),
                  to: t(WINDOW_LABELS[adjustment.to]),
                })}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface TemplatePageProps {
  t: Translate;
  language: string;
  units: Units;
  template: PlanTemplate;
  csrfToken: string;
  nonce: string;
  /** The repeat form's values and errors. */
  repeat: { date: string; time: string; errors: readonly FieldError[] };
  saved: boolean;
  /** Other devices removed by "Sign out all other devices", right after it (spec 3.2). */
  signedOut: number | undefined;
  /** One-time value for "Get a new link" (decision I44). */
  linkNonce: string;
  /** Set when the posting rules keep this device from repeating it: how to become allowed. */
  postingClosed: { requirement: PostingNeed; contactEmail: string | undefined } | undefined;
}

export function TemplatePage(props: TemplatePageProps) {
  const { t, template, units } = props;
  const csrf = <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />;
  const base = `/templates/${template.id}`;
  const errorFor = (field: "date" | "time") => props.repeat.errors.find((e) => e.field === field);
  // The settings without a place of their own on the plan page, in one line.
  const settings = [
    t(`activity.${template.activity}`),
    t(template.joinMode === "open" ? "form.joinOpen" : "form.joinApproval"),
    t("form.retentionDays", { count: template.retentionDays }),
    `${t("form.recapWindow")}: ${t(WINDOW_LABELS[template.recapWindow])}`,
    t(`drop.${template.dropPolicy}`),
  ];
  // Each part in its own section, divided by hairlines; neutral, as a form page (decisions D11, D27).
  return (
    <section class="template sectioned">
      {props.saved && (
        <p class="notice" role="status">
          {t("template.saved")}
        </p>
      )}
      <p class="plan-context">{t("template.label")}</p>
      <h1>{template.title}</h1>
      <dl class="when-where">
        <div class="pill">
          <dt class="visually-hidden">{t("plan.when")}</dt>
          <dd>
            <span class="icon icon-calendar" aria-hidden="true"></span>
            <span>
              {t("template.startTime", { time: template.startTime, zone: template.timeZone })}
            </span>
          </dd>
        </div>
        <div class="pill">
          <dt class="visually-hidden">{t("plan.where")}</dt>
          <dd>
            <span class="icon icon-pin" aria-hidden="true"></span>
            <span>{template.area.label}</span>
          </dd>
        </div>
      </dl>
      <PlanMetrics t={t} details={template} units={units} language={props.language} />
      <p class="item-meta">{settings.join(" · ")}</p>
      {(template.exactStart !== undefined || template.hasRoute) && (
        <p class="item-meta">
          {[
            ...(template.exactStart === undefined ? [] : [t("template.includesExactStart")]),
            ...(template.hasRoute ? [t("template.includesRoute")] : []),
          ].join(" · ")}
        </p>
      )}
      <p class="hint">
        {t("template.expires", {
          date: formatDate(template.expiresAt, template.timeZone, props.language),
        })}
      </p>
      {props.postingClosed !== undefined && (
        <PostingClosed
          t={t}
          {...props.postingClosed}
          heading={{ level: 2, text: t("template.repeatHeading") }}
        />
      )}
      {props.postingClosed === undefined && (
        <section>
          <h2>{t("template.repeatHeading")}</h2>
          <form method="post" action={`${base}/repeat`} class="plan-form">
            <p class="hint">{t("template.repeatHint")}</p>
            {csrf}
            <input type="hidden" name="nonce" value={props.nonce} />
            <div class="field-row">
              {(["date", "time"] as const).map((field) => {
                const error = errorFor(field);
                return (
                  <div class={error === undefined ? "field" : "field field-invalid"}>
                    <label for={`field-${field}`}>
                      {t(field === "date" ? "form.date" : "form.time")}
                    </label>
                    <input
                      id={`field-${field}`}
                      name={field}
                      type={field}
                      required
                      value={props.repeat[field]}
                    />
                    {error !== undefined && <p class="error">{fieldErrorMessage(error.code, t)}</p>}
                  </div>
                );
              })}
            </div>
            <button type="submit">{t("template.repeatSubmit")}</button>
          </form>
        </section>
      )}
      <section>
        <div class="button-row">
          <a class="button secondary" href={`${base}/edit`}>
            {t("template.edit")}
          </a>
          <a class="button secondary" href={`${base}/export.zip`}>
            {t("export.template")}
          </a>
          {template.hasRoute && (
            <form method="post" action={`${base}/route/remove`}>
              {csrf}
              <button type="submit" class="secondary">
                {t("template.removeRoute")}
              </button>
            </form>
          )}
        </div>
      </section>
      <LinkTools
        t={t}
        base={base}
        csrfToken={props.csrfToken}
        signedOut={props.signedOut}
        notifications={false}
        nonce={props.linkNonce}
      />
      <section>
        <details class="danger-zone">
          <summary>{t("template.delete")}</summary>
          <p>{t("template.deleteExplain")}</p>
          <form method="post" action={`${base}/delete`}>
            {csrf}
            <button type="submit" class="danger">
              {t("template.deleteConfirm")}
            </button>
          </form>
        </details>
      </section>
    </section>
  );
}

/** Shown once after "Save as template": the template link exists only in this response. */
export function TemplateSavedPage({
  t,
  title,
  templateUrl,
  templatePath,
}: {
  t: Translate;
  title: string;
  templateUrl: string;
  templatePath: string;
}) {
  return (
    <section class="links">
      <h1>{t("template.savedHeading")}</h1>
      <p>{t("template.savedBody", { title })}</p>
      <h2>{t("template.link")}</h2>
      <p class="link-box">
        <code>{templateUrl}</code>
      </p>
      <p class="warning">{t("template.linkWarning")}</p>
      <p>
        <a class="button" href={templatePath}>
          {t("template.open")}
        </a>
      </p>
    </section>
  );
}
