// Host page (spec 5 features 7–9): edit, people, cancel, delete.
import type { Translate } from "../../../i18n/i18n.ts";
import type { HostPerson, HostRequest } from "../../../../application/host.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import type { RecapWindow } from "../../../../domain/schedule.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, retentionOptions } from "./format.ts";
import type { MapSettings } from "./maps.tsx";
import { PlanForm } from "./plan-form.tsx";
import { RecapShortenedNotice, RecapWindowSelect } from "./recap.tsx";
import { type PushSettings, PushSwitch } from "./push-switch.tsx";
import { RouteTrimField } from "./route-trim.tsx";
import type { Units } from "../../../../domain/units.ts";

export interface HostPageProps {
  t: Translate;
  planId: string;
  title: string;
  scope: "all" | "retention";
  canCancel: boolean;
  people: {
    participants: HostPerson[];
    interested: HostPerson[];
    requests: HostRequest[];
    rejected: HostPerson[];
    removed: HostPerson[];
  };
  values: PlanInput;
  errors: readonly FieldError[];
  csrfToken: string;
  timeZones: readonly string[];
  maxRetentionDays: number;
  saved: boolean;
  /** The recap window, after a save that shortened the chosen one (spec 3.10). */
  recapWindowShortened: RecapWindow | undefined;
  /** A retention edit would delete the plan now and needs confirmation (spec 3.1). */
  confirmDeleteNow: boolean;
  push: PushSettings;
  /** Whether pending requests can still be decided (spec 3.1: not after the start). */
  requestsOpen: boolean;
  /** Switching to open mode would accept this many pending requests; asks first (spec 3.4). */
  confirmAcceptPending: number | undefined;
  hasRoute: boolean;
  /** Error code from the last route upload. */
  routeError: string | undefined;
  map: MapSettings | undefined;
  placeSearch: boolean;
  /** The submitted "hide start and end" choice of the last route upload. */
  routeTrim: string;
  units: Units;
  /** Contributions in the recap, from the start of an active plan on (spec 6 feature 7). */
  recapContributions: number | undefined;
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
      {props.recapWindowShortened !== undefined && (
        <RecapShortenedNotice t={t} window={props.recapWindowShortened} />
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
          withGpx={false}
          map={props.map}
          placeSearch={props.placeSearch}
          routeTrim=""
          units={props.units}
          confirmAcceptPending={props.confirmAcceptPending}
        />
      ) : (
        <RetentionForm {...props} />
      )}

      {props.scope === "all" && <RouteSection {...props} />}

      <section class="people">
        <h2>{t("host.people")}</h2>
        <PushSwitch t={t} push={props.push} hint={t("push.hostHint")} />
        {Object.values(props.people).every((list) => list.length === 0) ? (
          <p>{t("host.noPeople")}</p>
        ) : (
          <>
            <RequestList
              t={t}
              requests={props.people.requests}
              open={props.requestsOpen}
              planId={planId}
              csrfToken={csrfToken}
            />
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
              heading={t("host.rejected")}
              people={props.people.rejected}
              action="restore"
              label={t("host.undoReject")}
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

      {props.recapContributions !== undefined && props.recapContributions > 0 && (
        <details class="danger-zone">
          <summary>{t("host.recapDelete")}</summary>
          <p>{t("host.recapDeleteExplain", { count: props.recapContributions })}</p>
          <form method="post" action={`/p/${planId}/host/recap/delete`}>
            {csrf}
            <button type="submit" class="danger">
              {t("host.recapDeleteConfirm")}
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

function RouteSection(props: HostPageProps) {
  const { t, planId } = props;
  return (
    <section class="route">
      <h2>{t("host.route")}</h2>
      <p>{props.hasRoute ? t("host.routePresent") : t("host.routeNone")}</p>
      <form method="post" action={`/p/${planId}/host/route`} enctype="multipart/form-data">
        <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
        <div class={props.routeError === undefined ? "field" : "field field-invalid"}>
          <label for="field-route">{t("form.gpx")}</label>
          <input
            id="field-route"
            type="file"
            name="gpx"
            accept=".gpx,application/gpx+xml"
            required
          />
          <p class="hint">{t("host.routeHint")}</p>
          {props.routeError !== undefined && (
            <p class="error">{fieldErrorMessage(props.routeError, t)}</p>
          )}
        </div>
        <RouteTrimField
          t={t}
          id="field-route-trim"
          selected={props.routeTrim}
          units={props.units}
        />
        <button type="submit">
          {props.hasRoute ? t("host.routeReplace") : t("host.routeUpload")}
        </button>
      </form>
      {props.hasRoute && (
        <form method="post" action={`/p/${planId}/host/route/remove`}>
          <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
          <button type="submit" class="secondary">
            {t("host.routeRemove")}
          </button>
        </form>
      )}
    </section>
  );
}

function RetentionForm(props: HostPageProps) {
  const { t, planId } = props;
  const errorFor = (field: string) => props.errors.find((e) => e.field === field);
  const error = errorFor("retentionDays");
  const recapError = errorFor("recapWindow");
  return (
    <form method="post" action={`/p/${planId}/host`} class="plan-form">
      <h1>{t("host.heading")}</h1>
      <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
      <p class="hint">{t("host.retentionOnly")}</p>
      {props.confirmDeleteNow ? (
        <>
          <input type="hidden" name="retentionDays" value={props.values.retentionDays} />
          <input type="hidden" name="recapWindow" value={props.values.recapWindow} />
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
                  {t("form.retentionDays", { count: Number(days) })}
                </option>
              ))}
            </select>
            {error !== undefined && <p class="error">{fieldErrorMessage(error.code, t)}</p>}
          </div>
          <div class={recapError === undefined ? "field" : "field field-invalid"}>
            <label for="field-recapWindow">{t("form.recapWindow")}</label>
            <RecapWindowSelect t={t} id="field-recapWindow" selected={props.values.recapWindow} />
            <p class="hint">{t("host.recapWindowHint")}</p>
            {recapError !== undefined && (
              <p class="error">{fieldErrorMessage(recapError.code, t)}</p>
            )}
          </div>
          <button type="submit">{t("host.save")}</button>
        </>
      )}
    </form>
  );
}

/** Pending requests with their notes, each with Accept and Reject (spec 6 feature 1). */
function RequestList(props: {
  t: Translate;
  requests: readonly HostRequest[];
  /** Before the start only; afterwards requests stay unanswered (spec 3.1). */
  open: boolean;
  planId: string;
  csrfToken: string;
}) {
  if (props.requests.length === 0) return null;
  const { t } = props;
  return (
    <>
      <h3>{t("host.requests")}</h3>
      <ul class="people-actions requests">
        {props.requests.map((request) => (
          <li>
            <span>{request.name}</span>
            {request.note !== undefined && <p class="request-note">{request.note}</p>}
            {props.open && (
              <div class="buttons">
                {(["accept", "reject"] as const).map((action) => (
                  <form
                    method="post"
                    action={`/p/${props.planId}/host/people/${request.responseId}/${action}`}
                  >
                    <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
                    <button type="submit" class={action === "reject" ? "secondary" : undefined}>
                      {t(action === "accept" ? "host.accept" : "host.reject")}
                    </button>
                  </form>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function PeopleList(props: {
  t: Translate;
  heading: string;
  people: readonly HostPerson[];
  action: "remove" | "restore";
  /** Button text; defaults to "Remove" or "Undo removal". */
  label?: string;
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
                {props.label ?? props.t(props.action === "remove" ? "host.remove" : "host.restore")}
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
