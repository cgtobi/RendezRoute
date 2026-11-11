// Plan page (spec 5 features 3 and 5). Renders only what the read model contains (spec 2a);
// which model it receives decides what may be shown (spec 3.6).
import type { Child } from "hono/jsx";
import type { Translate } from "../../../i18n/i18n.ts";
import type {
  PersonView,
  PlanViewForParticipant,
  PlanViewForPoster,
  PlanViewForResponder,
  PlanViewForViewer,
} from "../../../../application/plan-views.ts";
import type { Units } from "../../../../domain/units.ts";
import { ShareLinks } from "./share.tsx";
import type { ExactStart } from "../../../../domain/geo.ts";
import {
  formatDate,
  formatDay,
  formatPercent,
  formatTemperature,
  formatTime,
  formatWindSpeed,
} from "./format.ts";
import { Initial } from "./avatar.tsx";
import { WhenWhereLines } from "./when-where.tsx";
import { PlanMetrics } from "./plan-metrics.tsx";
import { ResponseStatus } from "./response-status.tsx";
import { Linkified } from "./linkify.tsx";
import { type MapSettings, PlanMap } from "./maps.tsx";
import type { WeatherView } from "../../../../application/weather.ts";
import { RatingResultSection, RatingSection } from "./rating.tsx";
import { RecapSection } from "./recap.tsx";
import { RespondForm, type RespondFormState } from "./respond-form.tsx";

export type PlanPageAudience =
  | { kind: "viewer"; view: PlanViewForViewer }
  | { kind: "responder"; view: PlanViewForResponder }
  | { kind: "participant"; view: PlanViewForParticipant }
  | { kind: "poster"; view: PlanViewForPoster };

export function PlanPage(props: {
  t: Translate;
  language: string;
  units: Units;
  audience: PlanPageAudience;
  responsesOpen: boolean;
  /** The response form's state; shown to viewers while responses are open. */
  respondForm: RespondFormState | undefined;
  /** Tile settings; undefined when maps are disabled. */
  map: MapSettings | undefined;
  /** The absolute public link, for the share helpers. */
  planUrl: string;
  /** The forecast for the start, when weather is on and there is one (spec 6 feature 4). */
  forecast?: WeatherView | undefined;
  /** An active plan that has started: the recap's public layer is shown (spec 6 feature 5). */
  hasRecap: boolean;
  /** For the recap forms. */
  csrfToken: string;
  /** Show "Report this plan": instance admin authentication is configured (spec 7 Moderation). */
  reporting: boolean;
}) {
  const { t, language, units, audience, map } = props;
  const { view } = audience;
  const insider = audience.kind === "participant" || audience.kind === "poster";
  // The plans a calendar feed lists: rejected and removed people are no longer in (spec 6 feature 2).
  const inFeed =
    insider ||
    (audience.kind === "responder" &&
      audience.view.ownResponse.kind !== "rejected" &&
      audience.view.ownResponse.kind !== "removed");

  // Adding the plan to the calendar is the page's main action while it lies ahead for someone
  // who is in; before that, responding is, and afterwards rating (one primary per page, D27).
  const hasAfterStart =
    props.hasRecap ||
    (audience.kind === "poster" && audience.view.ratingResult !== undefined) ||
    (audience.kind === "participant" && audience.view.rating !== undefined);
  const calendarIsMain = inFeed && view.status === "active" && !props.hasRecap;
  const counts = (
    <p class="counts">
      {t("plan.counts", {
        participants: view.counts.participants,
        interested: view.counts.interested,
      })}
    </p>
  );

  // Two columns from 960 px (decision D27): the plan on the left, you and the group on the right.
  return (
    <article class="plan">
      <div class="plan-main">
        {/* The title in a block tinted in the plan's primary colour, who posts it below (D30). */}
        <header class="plan-header">
          <h1>{view.title}</h1>
          <p class="plan-byline">
            <span class="plan-activity">{t(`activity.${view.activity}`)}</span>{" "}
            {/* Who can find the plan, when more than people with the link (design note). */}
            {view.visibility === "public" && (
              <>
                <span class="plan-visibility">
                  <span class="icon icon-globe" aria-hidden="true"></span>
                  {t("plan.public")}
                </span>{" "}
              </>
            )}
            <span>{t("plan.postedBy", { name: view.posterName })}</span>{" "}
            <span class="badge">{t("plan.host")}</span>
          </p>
        </header>

        {view.status === "cancelled" && (
          <p class="warning" role="status">
            {t("plan.cancelled")}
          </p>
        )}
        {audience.kind === "poster" && (
          <p class="notice">
            {t("plan.youAreHost")} <a href={`/p/${view.id}/host`}>{t("plan.managePlan")}</a>
          </p>
        )}
        {audience.kind === "poster" && audience.view.pendingRequests > 0 && (
          <p class="notice">
            <a href={`/p/${view.id}/host`}>
              {t("plan.pendingRequests", { count: audience.view.pendingRequests })}
            </a>
          </p>
        )}

        <WhenWhereLines
          t={t}
          when={
            <>
              {formatDay(view.startsAt, view.timeZone, language)},{" "}
              {formatTime(view.startsAt, view.timeZone, language)}{" "}
              <span class="time-zone" data-time-zone={view.timeZone}>
                ({t("plan.timeZone", { zone: view.timeZone })})
              </span>
            </>
          }
          where={view.area.label}
        />

        <PlanMetrics t={t} details={view} units={units} language={language} tiles>
          <div class="metric">
            <dt class="visually-hidden">{t("plan.group")}</dt>
            <dd>{t(`drop.${view.dropPolicy}`)}</dd>
          </div>
        </PlanMetrics>

        {view.note !== undefined && (
          <p class="note">
            <Linkified text={view.note} />
          </p>
        )}

        {map !== undefined && view.area.point !== undefined && (
          <PlanMap
            t={t}
            map={map}
            area={view.area.point}
            exact={insider ? audience.view.exactStart?.point : undefined}
            routeUrl={insider && audience.view.hasRoute ? `/p/${view.id}/route.geojson` : undefined}
          />
        )}

        {(audience.kind === "participant" || audience.kind === "poster") && (
          <ExactStartSection t={t} exactStart={audience.view.exactStart} />
        )}

        {(audience.kind === "participant" || audience.kind === "poster") &&
          audience.view.hasRoute && (
            <section class="route">
              <h2>{t("plan.route")}</h2>
              <p>
                <a href={`/p/${view.id}/route.gpx`}>{t("plan.downloadGpx")}</a>
              </p>
            </section>
          )}

        {view.status !== "cancelled" && <ShareLinks t={t} url={props.planUrl} title={view.title} />}
      </div>

      <div class="plan-side">
        {!insider && counts}
        {(audience.kind === "responder" || audience.kind === "participant") && (
          <ResponseStatus
            t={t}
            response={audience.view.ownResponse}
            action={{ href: `/p/${view.id}/me`, label: t("plan.manageResponse") }}
          />
        )}
        {audience.kind === "viewer" &&
          (props.responsesOpen && props.respondForm !== undefined ? (
            <RespondForm
              t={t}
              planId={view.id}
              joinMode={view.joinMode}
              state={props.respondForm}
            />
          ) : (
            <p class="notice">{t("respond.closed")}</p>
          ))}

        {props.forecast !== undefined && (
          <WeatherSection t={t} language={language} units={units} forecast={props.forecast} />
        )}

        {(audience.kind === "participant" || audience.kind === "poster") && (
          <People
            heading={t("plan.participants")}
            people={audience.view.participants}
            t={t}
            language={language}
          >
            {counts}
          </People>
        )}
        {audience.kind === "poster" && audience.view.interested.length > 0 && (
          <People
            heading={t("plan.interestedPeople")}
            people={audience.view.interested}
            t={t}
            language={language}
          />
        )}

        <p class="deletion">
          {t("plan.deletion", { date: formatDate(view.deleteAt, view.timeZone, language) })}
        </p>
        <p class="actions">
          <a
            class={calendarIsMain ? "button" : "button secondary"}
            href={`/p/${view.id}/calendar.ics`}
          >
            <span class="icon icon-calendar" aria-hidden="true"></span>
            {t("plan.addToCalendar")}
          </a>
          {inFeed && (
            <a class="button secondary" href="/calendar">
              {t("plan.subscribeCalendar")}
            </a>
          )}
        </p>
        {props.reporting && (
          <p class="report-link">
            <a href={`/p/${view.id}/report`} rel="nofollow">
              {t("report.link")}
            </a>
          </p>
        )}
      </div>

      {/* After you and the group, so phones show the response before the recap. */}
      {hasAfterStart && (
        <div class="plan-after">
          {props.hasRecap && (
            <RecapSection
              t={t}
              language={language}
              planId={view.id}
              timeZone={view.timeZone}
              participants={view.counts.participants}
              recap={insider ? audience.view.recap : undefined}
              isHost={audience.kind === "poster"}
              csrfToken={props.csrfToken}
            />
          )}
          {audience.kind === "poster" && audience.view.ratingResult !== undefined && (
            <RatingResultSection t={t} closed result={audience.view.ratingResult} />
          )}
          {audience.kind === "participant" && audience.view.rating !== undefined && (
            <RatingSection
              t={t}
              planId={view.id}
              rating={audience.view.rating}
              csrfToken={props.csrfToken}
            />
          )}
        </div>
      )}
    </article>
  );
}

/** The forecast for the start hour, with the attribution Open-Meteo asks for (CC BY 4.0). */
function WeatherSection({
  t,
  language,
  units,
  forecast,
}: {
  t: Translate;
  language: string;
  units: Units;
  forecast: WeatherView;
}) {
  const parts = [
    forecast.condition === undefined ? undefined : t(`weather.${forecast.condition}`),
    formatTemperature(forecast.temperatureC, units, language, t),
    forecast.precipitationProbability === undefined
      ? undefined
      : t("weather.rainChance", {
          percent: formatPercent(forecast.precipitationProbability, language),
        }),
    t("weather.wind", { speed: formatWindSpeed(forecast.windKmh, units, language, t) }),
  ].filter((part) => part !== undefined);
  return (
    <section class="weather">
      <h2>{t("plan.weather")}</h2>
      <p>{parts.join(" · ")}</p>
      <p class="hint">
        {t("weather.hint")} {t("weather.source")}{" "}
        <a href="https://open-meteo.com/" rel="noopener noreferrer">
          Open-Meteo.com
        </a>
      </p>
    </section>
  );
}

function ExactStartSection({
  t,
  exactStart,
}: {
  t: Translate;
  exactStart: ExactStart | undefined;
}) {
  if (exactStart === undefined) return null;
  const { point } = exactStart;
  return (
    <section class="exact-start">
      <h2>
        <span class="icon icon-lock" aria-hidden="true"></span>
        {t("plan.exactStart")}
      </h2>
      <p class="hint">{t("plan.exactStartPrivate")}</p>
      {exactStart.description !== undefined && (
        <p>
          <Linkified text={exactStart.description} />
        </p>
      )}
      {point !== undefined && (
        <p>
          {point.lat}, {point.lng} ·{" "}
          <a href={`geo:${point.lat},${point.lng}`}>{t("plan.openMapsApp")}</a> ·{" "}
          <a
            href={`https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=17/${point.lat}/${point.lng}`}
            rel="noopener noreferrer"
          >
            {t("plan.openStreetMap")}
          </a>
        </p>
      )}
    </section>
  );
}

function People({
  heading,
  people,
  t,
  language,
  children,
}: {
  heading: string;
  people: readonly PersonView[];
  t: Translate;
  language: string;
  /** Shown beside the heading (the counts). */
  children?: Child;
}) {
  return (
    <section class="people">
      <div class="section-head">
        <h2>{heading}</h2>
        {children}
      </div>
      <ul class="people-list">
        {people.map((person) => {
          return (
            // A round initial with the name below. The host's mark follows the name, so it reads
            // "Anna, host": an icon on the initial, the same size in every language (D30).
            <li class="person">
              <Initial name={person.name} language={language} host={person.isHost} />
              <span class="person-label">{person.name}</span>
              {person.isHost && (
                <span class="host-mark">
                  <span class="icon icon-flag" aria-hidden="true"></span>
                  <span class="visually-hidden">{t("plan.host")}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
