// Host page (spec 5 features 7–9): edit, people, cancel, delete.
import type { Translate } from "../../../i18n/i18n.ts";
import type { HostPerson, HostRequest } from "../../../../application/host.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import type { RecapWindow } from "../../../../domain/schedule.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, retentionOptions } from "./format.ts";
import type { MapSettings } from "./maps.tsx";
import { PlanForm, RouteRemoveForm, type VisibilityChoice } from "./plan-form.tsx";
import { RecapShortenedNotice, RecapWindowSelect } from "./recap.tsx";
import { TemplateOptions } from "./templates.tsx";
import { type LinkEmail, LinkTools } from "./link-tools.tsx";
import { RatingResultSection } from "./rating.tsx";
import type { RatingResultView } from "../../../../application/plan-views.ts";
import { EmailSwitch, type EmailSwitchProps } from "./email-switch.tsx";
import {
  MoreChannels,
  type NtfySwitchProps,
  SharedSettingsNotice,
  type TelegramSwitchProps,
} from "./more-channels.tsx";
import { type PushSettings, PushSwitch } from "./push-switch.tsx";
import type { Units } from "../../../../domain/units.ts";
import { PersonName } from "./avatar.tsx";
import { BackLink } from "./back-link.tsx";

export interface HostPageProps {
  t: Translate;
  /** Who can find the plan: whether its owner may make it public (decision D35). */
  visibility: VisibilityChoice;
  language: string;
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
  map: MapSettings | undefined;
  placeSearch: boolean;
  /** The submitted "hide start and end" choice, kept when the form is shown again. */
  routeTrim: string;
  /** A route file was chosen but not saved; the browser does not keep it (decision D10). */
  gpxDropped: boolean;
  units: Units;
  /** Contributions in the recap, from the start of an active plan on (spec 6 feature 7). */
  recapContributions: number | undefined;
  /** From the start of an active plan on (spec 6a): whether ratings closed, and the result once due. */
  rating: { closed: boolean; result: RatingResultView | undefined } | undefined;
  /** One-time value for "Save as template" (decision I9). */
  templateNonce: string;
  /** Other devices removed by "Sign out all other devices", right after it (spec 3.2). */
  signedOut: number | undefined;
  /** One-time value for "Get a new link" (decision I44). */
  linkNonce: string;
  /** "Email me my links" (decision D31). */
  linkEmail: LinkEmail | undefined;
  /** Email notifications; undefined without SMTP (decision D31). */
  email: EmailSwitchProps | undefined;
  /** ntfy; undefined without NTFY_URL (decision D33). */
  ntfy: NtfySwitchProps | undefined;
  /** Telegram; undefined without a bot (decision D34). */
  telegram: TelegramSwitchProps | undefined;
}

/** The "Remove route" form, outside the edit form whose confirm button submits it (decision D10). */
const ROUTE_REMOVE_FORM = "route-remove";

export function HostPage(props: HostPageProps) {
  const { t, planId, csrfToken } = props;
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;

  return (
    <section class="host sectioned">
      <BackLink href={`/p/${planId}`} label={t("host.back")} />
      {/* Which plan this page manages (decision D11). The editable form shows the title in its own
          input (decision D71), so the line stays only where the form is not editable. */}
      {props.scope === "retention" && <p class="plan-context">{props.title}</p>}
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
          withGpx
          route={{ present: props.hasRoute, removeFormId: ROUTE_REMOVE_FORM }}
          gpxDropped={props.gpxDropped}
          map={props.map}
          placeSearch={props.placeSearch}
          routeTrim={props.routeTrim}
          units={props.units}
          confirmAcceptPending={props.confirmAcceptPending}
          visibility={props.visibility}
          saveBar
        />
      ) : (
        <RetentionForm {...props} />
      )}

      {props.scope === "all" && props.hasRoute && (
        <RouteRemoveForm
          id={ROUTE_REMOVE_FORM}
          action={`/p/${planId}/host/route/remove`}
          csrfToken={csrfToken}
        />
      )}

      {props.rating !== undefined && <RatingResultSection t={t} {...props.rating} />}

      <section class="people">
        <h2>{t("host.people")}</h2>
        <PushSwitch t={t} push={props.push} hint={t("push.hostHint")} />
        {props.email !== undefined && <EmailSwitch t={t} csrfToken={csrfToken} {...props.email} />}
        <MoreChannels t={t} csrfToken={csrfToken} ntfy={props.ntfy} telegram={props.telegram} />
        <SharedSettingsNotice t={t} link="host" email={props.email} ntfy={props.ntfy} />
        {Object.values(props.people).every((list) => list.length === 0) ? (
          <p>{t("host.noPeople")}</p>
        ) : (
          <>
            <RequestList
              t={t}
              language={props.language}
              requests={props.people.requests}
              open={props.requestsOpen}
              planId={planId}
              csrfToken={csrfToken}
            />
            <p class="hint">{t("host.removeHint")}</p>
            <PeopleList
              t={t}
              language={props.language}
              heading={t("host.participants")}
              people={props.people.participants}
              action="remove"
              planId={planId}
              csrfToken={csrfToken}
            />
            <PeopleList
              t={t}
              language={props.language}
              heading={t("host.interested")}
              people={props.people.interested}
              action="remove"
              planId={planId}
              csrfToken={csrfToken}
            />
            <PeopleList
              t={t}
              language={props.language}
              heading={t("host.rejected")}
              people={props.people.rejected}
              action="restore"
              label={t("host.undoReject")}
              planId={planId}
              csrfToken={csrfToken}
            />
            <PeopleList
              t={t}
              language={props.language}
              heading={t("host.removed")}
              people={props.people.removed}
              action="restore"
              planId={planId}
              csrfToken={csrfToken}
            />
          </>
        )}
      </section>

      <p>
        <a class="button secondary" href={`/p/${planId}/host/export.zip`}>
          {t("export.plan")}
        </a>
      </p>

      <LinkTools
        t={t}
        base={`/p/${planId}/host`}
        csrfToken={csrfToken}
        signedOut={props.signedOut}
        notifications
        nonce={props.linkNonce}
        email={props.linkEmail}
      />

      <details>
        <summary>{t("host.saveTemplate")}</summary>
        <p>{t("host.saveTemplateExplain")}</p>
        <form method="post" action={`/p/${planId}/host/template`}>
          {csrf}
          <input type="hidden" name="nonce" value={props.templateNonce} />
          <label class="choice">
            <input type="checkbox" name="includePrivate" value="1" />
            {t("form.templateIncludePrivate")}
          </label>
          <button type="submit" class="secondary">
            {t("host.saveTemplateConfirm")}
          </button>
        </form>
      </details>

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
          <input type="hidden" name="keepAsTemplate" value={props.values.keepAsTemplate} />
          <input
            type="hidden"
            name="templateIncludePrivate"
            value={props.values.templateIncludePrivate}
          />
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
            <select
              id="field-retentionDays"
              name="retentionDays"
              aria-invalid={error === undefined ? undefined : "true"}
              aria-describedby={error === undefined ? undefined : "field-retentionDays-error"}
            >
              {retentionOptions(props.maxRetentionDays, props.values.retentionDays).map((days) => (
                <option value={days} selected={props.values.retentionDays === days}>
                  {t("form.retentionDays", { count: Number(days) })}
                </option>
              ))}
            </select>
            {error !== undefined && (
              <p class="error" id="field-retentionDays-error">
                {fieldErrorMessage(error.code, t)}
              </p>
            )}
          </div>
          <div class={recapError === undefined ? "field" : "field field-invalid"}>
            <label for="field-recapWindow">{t("form.recapWindow")}</label>
            <RecapWindowSelect
              t={t}
              id="field-recapWindow"
              selected={props.values.recapWindow}
              invalid={recapError !== undefined}
            />
            <p class="hint">{t("host.recapWindowHint")}</p>
            {recapError !== undefined && (
              <p class="error" id="field-recapWindow-error">
                {fieldErrorMessage(recapError.code, t)}
              </p>
            )}
          </div>
          <TemplateOptions t={t} values={props.values} errors={props.errors} />
          <button type="submit">{t("host.save")}</button>
        </>
      )}
    </form>
  );
}

/** Pending requests with their notes, each with Accept and Reject (spec 6 feature 1). */
function RequestList(props: {
  t: Translate;
  language: string;
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
            <PersonName name={request.name} language={props.language} />
            {request.note !== undefined && <p class="request-note">{request.note}</p>}
            {props.open && (
              <div class="button-row">
                {(["accept", "reject"] as const).map((action) => (
                  <form
                    method="post"
                    action={`/p/${props.planId}/host/people/${request.responseId}/${action}`}
                  >
                    <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
                    <button type="submit" class="secondary">
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
  language: string;
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
            <PersonName name={person.name} language={props.language} />
            <form
              method="post"
              action={`/p/${props.planId}/host/people/${person.responseId}/${props.action}`}
            >
              <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
              <button type="submit" class="secondary">
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
  /** The plan opted in to "Keep as repeatable template" (spec 3.10). */
  keepsTemplate: boolean;
  csrfToken: string;
}) {
  const { t } = props;
  return (
    <section class="host">
      <BackLink href={`/p/${props.planId}/host`} label={t("host.heading")} />
      <h1>{t("host.deleteHeading", { title: props.title })}</h1>
      <p class="warning">{t("host.deleteExplain", { count: props.responseCount })}</p>
      {props.keepsTemplate && <p>{t("host.deleteKeepsTemplate")}</p>}
      <form method="post" action={`/p/${props.planId}/host/delete`}>
        <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
        <button type="submit" class="danger">
          {t("host.deleteConfirm")}
        </button>
      </form>
    </section>
  );
}
