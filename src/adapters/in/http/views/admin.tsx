// The instance admin pages (spec 7 Moderation): login, the admin's home with the open reports, and a
// plan's public details with its reports, "Resolve" and "Delete". Forms and links are relative to
// the admin directory (spec 3.8 URLs).
import type { OpenReportSummary, ReportView } from "../../../../application/admin.ts";
import type { PlanViewForInstanceAdmin } from "../../../../application/plan-views.ts";
import type { InviteView } from "../../../../application/posting.ts";
import {
  INVITE_LIMITS,
  type InviteError,
  type InviteInput,
  type InviteState,
} from "../../../../domain/invite.ts";
import type { MessageKey } from "../../../i18n/messages/en.ts";
import { postText, REASON_LABELS } from "./report.tsx";
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { BackLink } from "./back-link.tsx";
import { fieldErrorMessage, formatDate, formatDay, formatTime } from "./format.ts";
import { Item } from "./item.tsx";
import { WhenWhere } from "./when-where.tsx";

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
  invites,
}: {
  t: Translate;
  csrfToken: string;
  /** Relative path to /admin/ from the current page. */
  adminDir: string;
  deleted: boolean;
  /** A plan, report or invite the admin asked for that does not exist (any more). */
  notFound: "plan" | "report" | "invite" | undefined;
  openReports: readonly OpenReportSummary[];
  /** Only with POSTING_MODE=invite. */
  invites: InvitesSectionProps | undefined;
}) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  // Finding a plan is the main action; the reports, invites and logging out each in their own
  // part (decision D27).
  return (
    <section class="admin sectioned">
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
      {notFound === "invite" && (
        <p class="warning" role="alert">
          {t("admin.inviteNotFound")}
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
          <ul class="items">
            {openReports.map((report) => (
              <Item
                href={`${adminDir}plans/${report.planId}#reports`}
                title={report.planTitle}
                meta={t(REASON_LABELS[report.reason])}
              />
            ))}
          </ul>
        )}
      </section>
      {invites !== undefined && (
        <InvitesSection {...invites} t={t} csrfToken={csrfToken} adminDir={adminDir} />
      )}
      <section>
        <form method="post" action={`${adminDir}logout`}>
          {csrf}
          <button type="submit" class="secondary">
            {t("admin.logout")}
          </button>
        </form>
      </section>
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
  // The public details as on the plan page, then the reports, then deleting: each in its own part
  // (decision D27). Neutral, as instance chrome (decision D11).
  const facts = [
    t(`activity.${view.activity}`),
    t("admin.postedBy", { name: view.posterName }),
    t("admin.counts", {
      participants: view.counts.participants,
      interested: view.counts.interested,
    }),
    ...(view.status === "cancelled" ? [t("plan.cancelled")] : []),
  ];
  return (
    <section class="admin sectioned">
      <BackLink href={adminDir} label={t("admin.back")} />
      <h1>{t("admin.planHeading", { title: view.title })}</h1>
      <p class="hint">{t("admin.planPublic")}</p>
      <WhenWhere
        t={t}
        when={
          <>
            {formatDay(view.startsAt, view.timeZone, language)},{" "}
            {formatTime(view.startsAt, view.timeZone, language)} ({view.timeZone})
          </>
        }
        where={view.areaLabel}
      />
      <p class="item-meta">{facts.join(" · ")}</p>
      <p class="hint">
        {t("plan.deletion", { date: formatDate(view.deleteAt, view.timeZone, language) })}
      </p>
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
      <section>
        <form method="post" action={`${adminDir}plans/${view.id}/delete`}>
          {csrf}
          <p class="warning">{t("admin.deleteExplain")}</p>
          <button type="submit" class="danger">
            {t("admin.deleteConfirm")}
          </button>
        </form>
      </section>
    </section>
  );
}

const INVITE_STATES: Readonly<Record<InviteState, MessageKey>> = {
  usable: "admin.inviteUsable",
  expired: "admin.inviteExpired",
  used_up: "admin.inviteUsedUp",
  revoked: "admin.inviteRevoked",
};

export interface InvitesSectionProps {
  language: string;
  /** The instance's time zone, in which an invite's last day ends. */
  timeZone: string;
  list: readonly InviteView[];
  /** One-time value for the form (decision I44). */
  nonce: string;
  /** What was typed, kept when the form shows errors. */
  values: InviteInput;
  errors: readonly InviteError[];
}

/** Invite links (spec 7 Moderation): a form for a new one, and every invite with its state. */
function InvitesSection(
  props: InvitesSectionProps & { t: Translate; csrfToken: string; adminDir: string },
) {
  const { t, language, timeZone } = props;
  const csrf = <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />;
  const errorFor = (field: InviteError["field"]) => props.errors.find((e) => e.field === field);
  const field = (
    name: InviteError["field"],
    input: { type: "date" | "number"; label: MessageKey; hint: string },
  ) => {
    const error = errorFor(name);
    return (
      <div class={error === undefined ? "field" : "field field-invalid"}>
        <label for={`field-${name}`}>{t(input.label)}</label>
        <input
          id={`field-${name}`}
          name={name}
          type={input.type}
          value={props.values[name]}
          {...(input.type === "number" ? { min: 1, max: INVITE_LIMITS.maxUses, step: 1 } : {})}
          aria-invalid={error === undefined ? undefined : "true"}
          aria-describedby={`field-${name}-${error === undefined ? "hint" : "error"}`}
        />
        <p class="hint" id={`field-${name}-hint`}>
          {input.hint}
        </p>
        {error !== undefined && (
          <p class="error" id={`field-${name}-error`}>
            {fieldErrorMessage(error.code, t)}
          </p>
        )}
      </div>
    );
  };
  return (
    <section class="admin-invites" id="invites">
      <h2>{t("admin.invites")}</h2>
      <p class="hint">{t("admin.invitesHint")}</p>
      <form method="post" action={`${props.adminDir}invites`}>
        {csrf}
        <input type="hidden" name="nonce" value={props.nonce} />
        <div class="field-row">
          {field("expiresOn", {
            type: "date",
            label: "admin.inviteExpiresOn",
            hint: t("admin.inviteExpiresOnHint", { zone: timeZone }),
          })}
          {field("maxUses", {
            type: "number",
            label: "admin.inviteMaxUses",
            hint: t("admin.inviteMaxUsesHint"),
          })}
        </div>
        <button type="submit" class="secondary">
          {t("admin.inviteCreate")}
        </button>
      </form>
      {props.list.length === 0 && <p>{t("admin.noInvites")}</p>}
      {props.list.length > 0 && (
        <ul class="items">
          {props.list.map((invite) => (
            <li class="item">
              <p class="item-title">{t(INVITE_STATES[invite.state])}</p>
              <p class="item-meta">
                {[
                  t("admin.inviteCreatedOn", {
                    date: formatDate(invite.createdAt, timeZone, language),
                  }),
                  ...(invite.expiresAt === undefined
                    ? []
                    : [
                        t("admin.inviteLastDay", {
                          // The link works until the last day ends, at midnight.
                          date: formatDate(
                            new Date(invite.expiresAt.getTime() - 1),
                            timeZone,
                            language,
                          ),
                        }),
                      ]),
                  invite.maxUses === undefined
                    ? t("admin.inviteUsed", { count: invite.uses })
                    : t("admin.inviteUses", { uses: invite.uses, max: invite.maxUses }),
                ].join(" · ")}
              </p>
              {invite.state === "usable" && (
                <form method="post" action={`${props.adminDir}invites/${invite.id}/revoke`}>
                  {csrf}
                  <button type="submit" class="secondary">
                    {t("admin.inviteRevoke")}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A new invite link, shown this once: only its hash is stored (spec 3.2). */
export function InviteCreated({
  t,
  url,
  adminDir,
}: {
  t: Translate;
  url: string;
  adminDir: string;
}) {
  return (
    <section class="admin">
      <BackLink href={`${adminDir}#invites`} label={t("admin.back")} />
      <h1>{t("admin.inviteCreatedHeading")}</h1>
      <p>{t("admin.inviteCreated")}</p>
      <p class="link-box">
        <code>{url}</code>
      </p>
      <p class="warning">{t("admin.inviteWarning")}</p>
    </section>
  );
}
