// The instance admin pages (spec 7 Moderation): login, the admin's home and a plan's public details
// with "Delete". Forms and links are relative to the admin directory (spec 3.8 URLs).
import type { PlanViewForInstanceAdmin } from "../../../../application/plan-views.ts";
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
}: {
  t: Translate;
  csrfToken: string;
  /** Relative path to /admin/ from the current page. */
  adminDir: string;
  deleted: boolean;
  notFound: boolean;
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
      <form method="post" action={`${adminDir}plans`}>
        {csrf}
        <div class={notFound ? "field field-invalid" : "field"}>
          <label for="field-plan">{t("admin.findPlan")}</label>
          <input id="field-plan" name="plan" required />
          <p class="hint">{t("admin.findPlanHint")}</p>
          {notFound && <p class="error">{t("admin.planNotFound")}</p>}
        </div>
        <button type="submit">{t("admin.findPlanSubmit")}</button>
      </form>
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
}: {
  t: Translate;
  language: string;
  csrfToken: string;
  adminDir: string;
  view: PlanViewForInstanceAdmin;
}) {
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
      <form method="post" action={`${adminDir}plans/${view.id}/delete`}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <p class="warning">{t("admin.deleteExplain")}</p>
        <button type="submit" class="danger">
          {t("admin.deleteConfirm")}
        </button>
      </form>
    </section>
  );
}
