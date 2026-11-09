// The instance admin pages (spec 7 Moderation): login, the admin's home with the open reports, and a
// plan's public details with its reports, "Resolve" and "Delete". Forms and links are relative to
// the admin directory (spec 3.8 URLs).
import type { OpenReportSummary, ReportView } from "../../../../application/admin.ts";
import type { PlanViewForInstanceAdmin } from "../../../../application/plan-views.ts";
import { postText, REASON_LABELS } from "./report.tsx";
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { formatDate, formatDay, formatTime } from "./format.ts";

export function AdminLogin({
  t,
  csrfToken,
  failed,
}: {
  t: Translate;
  csrfToken: string;
  failed: boolean;
}) {
  return (
    <section class="admin">
      <h1>{t("admin.loginHeading")}</h1>
      {failed && (
        <p class="error" role="alert">
          {t("admin.loginFailed")}
        </p>
      )}
      <form method="post" action="login">
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <div class="field">
          <label for="field-token">{t("admin.token")}</label>
          <input
            id="field-token"
            name="token"
            type="password"
            required
            autocomplete="current-password"
          />
          <p class="hint">{t("admin.tokenHint")}</p>
        </div>
        <button type="submit">{t("admin.login")}</button>
      </form>
    </section>
  );
}

export function AdminHome({
  t,
  csrfToken,
  adminDir,
  deleted,
  notFound,
  openReports,
}: {
  t: Translate;
  csrfToken: string;
  /** Relative path to /admin/ from the current page. */
  adminDir: string;
  deleted: boolean;
  /** A plan or report the admin asked for that does not exist (any more). */
  notFound: "plan" | "report" | undefined;
  openReports: readonly OpenReportSummary[];
}) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  return (
    <section class="admin">
      <h1>{t("admin.title")}</h1>
      {deleted && (
        <p class="notice" role="status">
          {t("admin.deleted")}
        </p>
      )}
      {notFound === "report" && (
        <p class="warning" role="alert">
          {t("admin.reportNotFound")}
        </p>
      )}
      <form method="post" action={`${adminDir}plans`}>
        {csrf}
        <div class={notFound === "plan" ? "field field-invalid" : "field"}>
          <label for="field-plan">{t("admin.findPlan")}</label>
          <input id="field-plan" name="plan" required />
          <p class="hint">{t("admin.findPlanHint")}</p>
          {notFound === "plan" && <p class="error">{t("admin.planNotFound")}</p>}
        </div>
        <button type="submit">{t("admin.findPlanSubmit")}</button>
      </form>
      <section class="admin-reports">
        <h2>{t("admin.openReports", { count: openReports.length })}</h2>
        {openReports.length > 0 && (
          <ul>
            {openReports.map((report) => (
              <li>
                <a href={`${adminDir}plans/${report.planId}#reports`}>{report.planTitle}</a> (
                {t(REASON_LABELS[report.reason])})
              </li>
            ))}
          </ul>
        )}
      </section>
      <form method="post" action={`${adminDir}logout`}>
        {csrf}
        <button type="submit" class="secondary">
          {t("admin.logout")}
        </button>
      </form>
    </section>
  );
}

/** Public fields only (spec 3.6, Instance admin column). */
export function AdminPlan({
  t,
  language,
  csrfToken,
  adminDir,
  view,
  reports,
}: {
  t: Translate;
  language: string;
  csrfToken: string;
  adminDir: string;
  view: PlanViewForInstanceAdmin;
  reports: { open: readonly ReportView[]; resolved: number };
}) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  return (
    <section class="admin">
      <p>
        <a href={adminDir}>{t("admin.back")}</a>
      </p>
      <h1>{t("admin.planHeading", { title: view.title })}</h1>
      <p class="hint">{t("admin.planPublic")}</p>
      <ul class="template-facts">
        <li>{t(`activity.${view.activity}`)}</li>
        <li>
          {formatDay(view.startsAt, view.timeZone, language)},{" "}
          {formatTime(view.startsAt, view.timeZone, language)} ({view.timeZone})
        </li>
        <li>{view.areaLabel}</li>
        <li>{t("admin.postedBy", { name: view.posterName })}</li>
        <li>
          {t("admin.counts", {
            participants: view.counts.participants,
            interested: view.counts.interested,
          })}
        </li>
        {view.status === "cancelled" && <li>{t("plan.cancelled")}</li>}
        <li>{t("plan.deletion", { date: formatDate(view.deleteAt, view.timeZone, language) })}</li>
      </ul>
      <section class="admin-reports" id="reports">
        <h2>{t("admin.openReports", { count: reports.open.length })}</h2>
        {reports.open.map((report) => (
          <article class="admin-report">
            <h3>
              {t(REASON_LABELS[report.reason])} ·{" "}
              {formatDay(report.createdAt, view.timeZone, language)},{" "}
              {formatTime(report.createdAt, view.timeZone, language)}
            </h3>
            {/* What reporters wrote, as plain text: no links to click here. */}
            {report.details !== undefined && <p class="report-details">{report.details}</p>}
            {report.attached.length > 0 && (
              <>
                <p class="hint">{t("admin.attached")}</p>
                <ul class="report-attached">
                  {report.attached.map((post) => (
                    <li>{postText(post)}</li>
                  ))}
                </ul>
              </>
            )}
            <form method="post" action={`${adminDir}reports/${report.id}/resolve`}>
              {csrf}
              <button type="submit" class="secondary">
                {t("admin.resolve")}
              </button>
            </form>
          </article>
        ))}
        {reports.resolved > 0 && (
          <p class="hint">{t("admin.resolvedReports", { count: reports.resolved })}</p>
        )}
      </section>
      <form method="post" action={`${adminDir}plans/${view.id}/delete`}>
        {csrf}
        <p class="warning">{t("admin.deleteExplain")}</p>
        <button type="submit" class="danger">
          {t("admin.deleteConfirm")}
        </button>
      </form>
    </section>
  );
}
