// Repeatable templates (spec 3.10 Templates, decision I43): the options on the plan forms, the
// list on the home page, the template page with "Repeat", and the page showing a new template link.
import type { Translate } from "../../../i18n/i18n.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import type { PlanTemplate, TemplateAdjustment } from "../../../../domain/template.ts";
import type { Units } from "../../../../domain/units.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, formatDate, formatDistance, formatPaceBand } from "./format.ts";
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

/** "Your templates" on the home page, for the devices linked to them. */
export function TemplateList({
  t,
  templates,
}: {
  t: Translate;
  templates: readonly Pick<PlanTemplate, "id" | "title">[];
}) {
  if (templates.length === 0) return null;
  return (
    <section class="templates">
      <h2>{t("home.templates")}</h2>
      <ul>
        {templates.map((template) => (
          <li>
            <a href={`/templates/${template.id}`}>{template.title}</a>
          </li>
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
}

export function TemplatePage(props: TemplatePageProps) {
  const { t, template, units } = props;
  const csrf = <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />;
  const base = `/templates/${template.id}`;
  const errorFor = (field: "date" | "time") => props.repeat.errors.find((e) => e.field === field);
  const facts: string[] = [
    t(`activity.${template.activity}`),
    t("template.startTime", { time: template.startTime, zone: template.timeZone }),
    template.area.label,
    ...(template.distanceMeters === undefined
      ? []
      : [formatDistance(template.distanceMeters, units, props.language, t)]),
    ...(template.pace === undefined
      ? []
      : [formatPaceBand(template.pace, template.activity, units, t)]),
    t(template.joinMode === "open" ? "form.joinOpen" : "form.joinApproval"),
    t("form.retentionDays", { count: template.retentionDays }),
    `${t("form.recapWindow")}: ${t(WINDOW_LABELS[template.recapWindow])}`,
  ];
  return (
    <section class="template">
      {props.saved && (
        <p class="notice" role="status">
          {t("template.saved")}
        </p>
      )}
      <p class="hint">{t("template.label")}</p>
      <h1>{template.title}</h1>
      <ul class="template-facts">
        {facts.map((fact) => (
          <li>{fact}</li>
        ))}
        {template.exactStart !== undefined && <li>{t("template.includesExactStart")}</li>}
        {template.hasRoute && <li>{t("template.includesRoute")}</li>}
      </ul>
      <p>
        {t("template.expires", {
          date: formatDate(template.expiresAt, template.timeZone, props.language),
        })}
      </p>

      <form method="post" action={`${base}/repeat`} class="plan-form">
        <h2>{t("template.repeatHeading")}</h2>
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

      <p>
        <a class="button secondary" href={`${base}/edit`}>
          {t("template.edit")}
        </a>
      </p>
      {template.hasRoute && (
        <form method="post" action={`${base}/route/remove`}>
          {csrf}
          <button type="submit" class="secondary">
            {t("template.removeRoute")}
          </button>
        </form>
      )}
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
