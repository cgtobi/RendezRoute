// The recap on the plan page (spec 6 features 5–7, decisions D19, I42): the public "took place"
// line for everyone, and for participants and the host the comments and links.
import type { ContributionView, RecapView } from "../../../../application/plan-views.ts";
import { CONTRIBUTION_LIMITS } from "../../../../domain/recap.ts";
import { RECAP_WINDOWS, type RecapWindow } from "../../../../domain/schedule.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import type { MessageKey } from "../../../i18n/messages/en.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, formatDay, formatTime } from "./format.ts";
import { Linkified } from "./linkify.tsx";

/** Known services, labelled by name as text; no brand icons (decision D19). */
const SERVICES: readonly [RegExp, string][] = [
  [/(^|\.)strava\.(com|app\.link)$/, "Strava"],
  [/(^|\.)komoot\.(com|de)$/, "Komoot"],
  [/^connect\.garmin\.com$/, "Garmin Connect"],
  [/(^|\.)ridewithgps\.com$/, "Ride with GPS"],
  [/(^|\.)relive\.(cc|com)$/, "Relive"],
  [/(^|\.)outdooractive\.com$/, "Outdooractive"],
  [/(^|\.)alltrails\.com$/, "AllTrails"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/^photos\.(google\.com|app\.goo\.gl)$/, "Google Photos"],
  [/(^|\.)flickr\.com$/, "Flickr"],
];

export function serviceName(url: string): string | undefined {
  const host = URL.parse(url)
    ?.hostname.toLowerCase()
    .replace(/^www\./, "");
  return host === undefined ? undefined : SERVICES.find(([pattern]) => pattern.test(host))?.[1];
}

/** The label of each recap window choice. */
export const WINDOW_LABELS: Readonly<Record<RecapWindow, MessageKey>> = {
  now: "form.recapWindowNow",
  "1d": "form.recapWindow1d",
  "1w": "form.recapWindow1w",
};

/** "The recap was shortened to fit how long the plan is kept" after saving (spec 3.10). */
export function RecapShortenedNotice({ t, window }: { t: Translate; window: RecapWindow }) {
  return (
    <p class="notice" role="status">
      {t("form.recapWindowShortened", { window: t(WINDOW_LABELS[window]) })}
    </p>
  );
}

/** A recap window from a query parameter, if it names one. */
export const recapWindowParam = (value: string | undefined): RecapWindow | undefined =>
  RECAP_WINDOWS.find((window) => window === value);

/** The recap window choice for the create and edit forms (spec 6 feature 6). */
export function RecapWindowSelect({
  t,
  id,
  selected,
}: {
  t: Translate;
  id: string;
  selected: string;
}) {
  return (
    <select id={id} name="recapWindow">
      {RECAP_WINDOWS.map((window) => (
        <option value={window} selected={selected === window}>
          {t(WINDOW_LABELS[window])}
        </option>
      ))}
    </select>
  );
}

/** The public layer: shown to everyone once an active plan has started. */
export function RecapSection(props: {
  t: Translate;
  language: string;
  planId: string;
  timeZone: string;
  participants: number;
  /** The private layer, for participants and the host only. */
  recap: RecapView | undefined;
  isHost: boolean;
  csrfToken: string;
}) {
  const { t, recap } = props;
  return (
    <section class="recap" id="recap">
      <h2>{t("recap.heading")}</h2>
      <p>{t("recap.tookPlace", { count: props.participants })}</p>
      {recap !== undefined && <PrivateRecap {...props} recap={recap} />}
    </section>
  );
}

function PrivateRecap(props: Parameters<typeof RecapSection>[0] & { recap: RecapView }) {
  const { t, language, recap, planId, timeZone } = props;
  const csrf = <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />;
  const when = `${formatDay(recap.closesAt, timeZone, language)}, ${formatTime(recap.closesAt, timeZone, language)}`;
  return (
    <>
      <p class="hint">{t("recap.private")}</p>
      <p>{recap.open ? t("recap.openUntil", { date: when }) : t("recap.closed")}</p>
      {recap.contributions.length === 0 ? (
        <p class="hint">{t("recap.empty")}</p>
      ) : (
        <ul class="contributions">
          {recap.contributions.map((contribution) => (
            <Contribution
              t={t}
              planId={planId}
              contribution={contribution}
              isHost={props.isHost}
              csrf={csrf}
            />
          ))}
        </ul>
      )}
      {recap.canContribute && (
        <ContributionForm
          t={t}
          action={`/p/${planId}/recap`}
          heading={t("recap.add")}
          submit={t("recap.submit")}
          values={{ body: "", linkUrl: "" }}
          errors={[]}
          csrfToken={props.csrfToken}
        />
      )}
    </>
  );
}

function Contribution({
  t,
  planId,
  contribution,
  isHost,
  csrf,
}: {
  t: Translate;
  planId: string;
  contribution: ContributionView;
  isHost: boolean;
  csrf: unknown;
}) {
  const base = `/p/${planId}/recap/${contribution.id}`;
  const service =
    contribution.linkUrl === undefined ? undefined : serviceName(contribution.linkUrl);
  return (
    <li class={contribution.hidden ? "contribution hidden-contribution" : "contribution"}>
      <p class="contribution-author">
        {contribution.authorName}
        {contribution.byHost && (
          <>
            {" "}
            <span class="badge">{t("plan.host")}</span>
          </>
        )}
      </p>
      {contribution.body !== undefined && (
        <p class="contribution-body">
          <Linkified text={contribution.body} />
        </p>
      )}
      {contribution.linkUrl !== undefined && (
        <p class="contribution-link">
          {service !== undefined && <span class="service">{service}</span>}{" "}
          <a href={contribution.linkUrl} rel="noopener noreferrer nofollow ugc">
            {contribution.linkUrl}
          </a>
        </p>
      )}
      {contribution.hidden && (
        <p class="hint">{isHost ? t("recap.hiddenForHost") : t("recap.hidden")}</p>
      )}
      <div class="contribution-actions">
        {contribution.own && <a href={`${base}/edit`}>{t("recap.edit")}</a>}
        {contribution.own && (
          <form method="post" action={`${base}/delete`}>
            {csrf}
            <button type="submit" class="secondary">
              {t("recap.delete")}
            </button>
          </form>
        )}
        {isHost && (
          <form method="post" action={`${base}/${contribution.hidden ? "show" : "hide"}`}>
            {csrf}
            <button type="submit" class="secondary">
              {contribution.hidden ? t("recap.show") : t("recap.hide")}
            </button>
          </form>
        )}
      </div>
    </li>
  );
}

/** Adding or editing a comment and link; also shown on its own page with errors. */
export function ContributionForm(props: {
  t: Translate;
  action: string;
  heading: string;
  submit: string;
  values: { body: string; linkUrl: string };
  errors: readonly { field: string; code: string }[];
  csrfToken: string;
  /** Shown above the form, e.g. the per-person limit. */
  notice?: string | undefined;
}) {
  const { t, values } = props;
  const errorFor = (field: string) => props.errors.find((e) => e.field === field);
  const field = (name: "body" | "linkUrl", label: string, input: unknown, hint?: string) => {
    const error = errorFor(name);
    return (
      <div class={error === undefined ? "field" : "field field-invalid"}>
        <label for={`field-${name}`}>{label}</label>
        {input}
        {hint !== undefined && <p class="hint">{hint}</p>}
        {error !== undefined && (
          <p class="error" id={`field-${name}-error`}>
            {fieldErrorMessage(error.code, t, { max: CONTRIBUTION_LIMITS.body })}
          </p>
        )}
      </div>
    );
  };
  return (
    <form method="post" action={props.action} class="contribution-form">
      <h3>{props.heading}</h3>
      <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
      {props.notice !== undefined && (
        <p class="warning" role="alert">
          {props.notice}
        </p>
      )}
      {field(
        "body",
        t("recap.body"),
        <textarea id="field-body" name="body" rows={3} maxlength={CONTRIBUTION_LIMITS.body}>
          {values.body}
        </textarea>,
      )}
      {field(
        "linkUrl",
        t("recap.link"),
        <input
          id="field-linkUrl"
          name="linkUrl"
          type="url"
          inputmode="url"
          value={values.linkUrl}
          maxlength={CONTRIBUTION_LIMITS.linkUrl}
          placeholder="https://"
        />,
        t("recap.linkHint"),
      )}
      <button type="submit">{props.submit}</button>
    </form>
  );
}
