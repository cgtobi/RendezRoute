// Plan page (spec 5 features 3 and 5). Renders only what the read model contains (spec 2a);
// which model it receives decides what may be shown (spec 3.6).
import type { Translate } from "../../../i18n/i18n.ts";
import type {
  PersonView,
  PlanViewForParticipant,
  PlanViewForPoster,
  PlanViewForResponder,
  PlanViewForViewer,
} from "../../../../application/plan-views.ts";
import { paceStyleFor } from "../../../../domain/activity.ts";
import type { Units } from "../../../../domain/units.ts";
import { ShareLinks } from "./share.tsx";
import type { ExactStart } from "../../../../domain/geo.ts";
import {
  formatDate,
  formatDay,
  formatDistance,
  formatElevation,
  formatPaceBand,
  formatPercent,
  formatTemperature,
  formatTime,
  formatWindSpeed,
} from "./format.ts";
import { Linkified } from "./linkify.tsx";
import { type MapSettings, PlanMap } from "./maps.tsx";
import type { WeatherView } from "../../../../application/weather.ts";
import { statusKey } from "./format.ts";
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

  return (
    <article class="plan">
      <header class="plan-header">
        <p class="plan-activity">{t(`activity.${view.activity}`)}</p>
        <h1>{view.title}</h1>
        <p>
          {t("plan.postedBy", { name: view.posterName })}{" "}
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

      <dl class="plan-facts">
        <dt>{t("plan.when")}</dt>
        <dd>
          {formatDay(view.startsAt, view.timeZone, language)},{" "}
          {formatTime(view.startsAt, view.timeZone, language)}{" "}
          <span class="time-zone" data-time-zone={view.timeZone}>
            ({t("plan.timeZone", { zone: view.timeZone })})
          </span>
        </dd>
        <dt>{t("plan.where")}</dt>
        <dd>{view.area.label}</dd>
        {view.distanceMeters !== undefined && (
          <>
            <dt>{t("plan.distance")}</dt>
            <dd>{formatDistance(view.distanceMeters, units, language, t)}</dd>
          </>
        )}
        {view.elevationGainMeters !== undefined && (
          <>
            <dt>{t("plan.elevation")}</dt>
            <dd>{formatElevation(view.elevationGainMeters, units, language, t)}</dd>
          </>
        )}
        {view.pace !== undefined && (
          <>
            <dt>{paceStyleFor(view.activity) === "pace" ? t("plan.pace") : t("plan.speed")}</dt>
            <dd>{formatPaceBand(view.pace, view.activity, units, t)}</dd>
          </>
        )}
        <dt>{t("plan.group")}</dt>
        <dd>{t(`drop.${view.dropPolicy}`)}</dd>
      </dl>

      {props.forecast !== undefined && (
        <WeatherSection t={t} language={language} units={units} forecast={props.forecast} />
      )}

      <p class="counts">
        {t("plan.counts", {
          participants: view.counts.participants,
          interested: view.counts.interested,
        })}
      </p>

      {view.status !== "cancelled" && <ShareLinks t={t} url={props.planUrl} title={view.title} />}

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

      {(audience.kind === "responder" || audience.kind === "participant") && (
        <section class="own-response">
          <h2>{t("plan.yourResponse")}</h2>
          <p>{t(statusKey(audience.view.ownResponse))}</p>
          <p>
            <a href={`/p/${view.id}/me`}>{t("plan.manageResponse")}</a>
          </p>
        </section>
      )}

      {(audience.kind === "participant" || audience.kind === "poster") && (
        <People heading={t("plan.participants")} people={audience.view.participants} t={t} />
      )}
      {audience.kind === "poster" && audience.view.interested.length > 0 && (
        <People heading={t("plan.interestedPeople")} people={audience.view.interested} t={t} />
      )}

      {audience.kind === "viewer" &&
        (props.responsesOpen && props.respondForm !== undefined ? (
          <RespondForm t={t} planId={view.id} joinMode={view.joinMode} state={props.respondForm} />
        ) : (
          <p class="notice">{t("respond.closed")}</p>
        ))}

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

      <p class="deletion">
        {t("plan.deletion", { date: formatDate(view.deleteAt, view.timeZone, language) })}
      </p>
      <p class="calendar-links">
        <a href={`/p/${view.id}/calendar.ics`}>{t("plan.addToCalendar")}</a>
        {inFeed && (
          <>
            {" · "}
            <a href="/calendar">{t("plan.subscribeCalendar")}</a>
          </>
        )}
      </p>
      {props.reporting && (
        <p class="report-link">
          <a href={`/p/${view.id}/report`} rel="nofollow">
            {t("report.link")}
          </a>
        </p>
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
      <h2>{t("plan.exactStart")}</h2>
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
}: {
  heading: string;
  people: readonly PersonView[];
  t: Translate;
}) {
  return (
    <section class="people">
      <h2>{heading}</h2>
      <ul>
        {people.map((person) => (
          <li>
            {person.name}
            {person.isHost && (
              <>
                {" "}
                <span class="badge">{t("plan.host")}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
