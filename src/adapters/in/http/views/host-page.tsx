// Host page (spec 5 features 7–9): edit, people, cancel, delete.
import type { Translate } from "../../../i18n/i18n.ts";
import type { HostPerson } from "../../../../application/host.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, retentionOptions } from "./format.ts";
import { PlanForm } from "./plan-form.tsx";

export interface HostPageProps {
  t: Translate;
  planId: string;
  title: string;
  scope: "all" | "retention";
  canCancel: boolean;
  people: { participants: HostPerson[]; interested: HostPerson[]; removed: HostPerson[] };
  values: PlanInput;
  errors: readonly FieldError[];
  csrfToken: string;
  timeZones: readonly string[];
  maxRetentionDays: number;
  saved: boolean;
  /** A retention edit would delete the plan now and needs confirmation (spec 3.1). */
  confirmDeleteNow: boolean;
}

export function HostPage(props: HostPageProps) {
  const { t, planId, csrfToken } = props;
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;

  return (
    <section class="host">
      <p>
        <a href={`/p/${planId}`}>{t("host.back")}</a>
      </p>
      {props.saved && (
        <p class="notice" role="status">
          {t("host.saved")}
        </p>
      )}

      {props.scope === "all" ? (
        <PlanForm
          t={t}
          values={props.values}
          errors={props.errors}
          csrfToken={csrfToken}
          nonce={undefined}
          timeZones={props.timeZones}
          maxRetentionDays={props.maxRetentionDays}
          action={`/p/${planId}/host`}
          heading={t("host.heading")}
          submitLabel={t("host.save")}
        />
      ) : (
        <RetentionForm {...props} />
      )}

      <section class="people">
        <h2>{t("host.people")}</h2>
        {props.people.participants.length +
          props.people.interested.length +
          props.people.removed.length ===
        0 ? (
          <p>{t("host.noPeople")}</p>
        ) : (
          <>
            <p class="hint">{t("host.removeHint")}</p>
            <PeopleList
              t={t}
              heading={t("host.participants")}
              people={props.people.participants}
              action="remove"
              planId={planId}
              csrfToken={csrfToken}
            />
            <PeopleList
              t={t}
              heading={t("host.interested")}
              people={props.people.interested}
              action="remove"
              planId={planId}
              csrfToken={csrfToken}
            />
            <PeopleList
              t={t}
              heading={t("host.removed")}
              people={props.people.removed}
              action="restore"
              planId={planId}
              csrfToken={csrfToken}
            />
          </>
        )}
      </section>

      {props.canCancel && (
        <details class="danger-zone">
          <summary>{t("host.cancel")}</summary>
          <p>{t("host.cancelExplain")}</p>
          <form method="post" action={`/p/${planId}/host/cancel`}>
            {csrf}
            <button type="submit" class="danger">
              {t("host.cancelConfirm")}
            </button>
          </form>
        </details>
      )}

      <p class="danger-zone">
        <a href={`/p/${planId}/host/delete`}>{t("host.delete")}</a>
      </p>
    </section>
  );
}

function RetentionForm(props: HostPageProps) {
  const { t, planId } = props;
  const error = props.errors.find((e) => e.field === "retentionDays");
  return (
    <form method="post" action={`/p/${planId}/host`} class="plan-form">
      <h1>{t("host.heading")}</h1>
      <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
      <p class="hint">{t("host.retentionOnly")}</p>
      {props.confirmDeleteNow ? (
        <>
          <input type="hidden" name="retentionDays" value={props.values.retentionDays} />
          <input type="hidden" name="confirmDeleteNow" value="1" />
          <p class="warning" role="alert">
            {t("host.deletesNowWarning")}
          </p>
          <button type="submit" class="danger">
            {t("host.deleteNow")}
          </button>
        </>
      ) : (
        <>
          <div class={error === undefined ? "field" : "field field-invalid"}>
            <label for="field-retentionDays">{t("form.retention")}</label>
            <select id="field-retentionDays" name="retentionDays">
              {retentionOptions(props.maxRetentionDays, props.values.retentionDays).map((days) => (
                <option value={days} selected={props.values.retentionDays === days}>
                  {days === "1" ? t("form.retentionOne") : t("form.retentionMany", { days })}
                </option>
              ))}
            </select>
            {error !== undefined && <p class="error">{fieldErrorMessage(error.code, t)}</p>}
          </div>
          <button type="submit">{t("host.save")}</button>
        </>
      )}
    </form>
  );
}

function PeopleList(props: {
  t: Translate;
  heading: string;
  people: readonly HostPerson[];
  action: "remove" | "restore";
  planId: string;
  csrfToken: string;
}) {
  if (props.people.length === 0) return null;
  return (
    <>
      <h3>{props.heading}</h3>
      <ul class="people-actions">
        {props.people.map((person) => (
          <li>
            <span>{person.name}</span>
            <form
              method="post"
              action={`/p/${props.planId}/host/people/${person.responseId}/${props.action}`}
            >
              <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
              <button type="submit" class={props.action === "remove" ? "secondary" : undefined}>
                {props.t(props.action === "remove" ? "host.remove" : "host.restore")}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}

export function DeleteConfirm(props: {
  t: Translate;
  planId: string;
  title: string;
  responseCount: number;
  csrfToken: string;
}) {
  const { t } = props;
  return (
    <section class="host">
      <h1>{t("host.deleteHeading", { title: props.title })}</h1>
      <p class="warning">{t("host.deleteExplain", { count: props.responseCount })}</p>
      <form method="post" action={`/p/${props.planId}/host/delete`}>
        <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
        <button type="submit" class="danger">
          {t("host.deleteConfirm")}
        </button>
      </form>
      <p>
        <a href={`/p/${props.planId}/host`}>{t("host.back")}</a>
      </p>
    </section>
  );
}
