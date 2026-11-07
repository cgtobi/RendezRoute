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
import type { ExactStart } from "../../../../domain/geo.ts";
import {
  formatDate,
  formatDay,
  formatKilometers,
  formatNumber,
  formatPaceBand,
  formatTime,
} from "./format.ts";
import { Linkified } from "./linkify.tsx";
import { RespondForm, type RespondFormState } from "./respond-form.tsx";

export type PlanPageAudience =
  | { kind: "viewer"; view: PlanViewForViewer }
  | { kind: "responder"; view: PlanViewForResponder }
  | { kind: "participant"; view: PlanViewForParticipant }
  | { kind: "poster"; view: PlanViewForPoster };

export function PlanPage(props: {
  t: Translate;
  language: string;
  audience: PlanPageAudience;
  responsesOpen: boolean;
  /** The response form's state; shown to viewers while responses are open. */
  respondForm: RespondFormState | undefined;
}) {
  const { t, language, audience } = props;
  const { view } = audience;

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

      <dl class="plan-facts">
        <dt>{t("plan.when")}</dt>
        <dd>
          {formatDay(view.startsAt, view.timeZone, language)},{" "}
          {formatTime(view.startsAt, view.timeZone, language)}{" "}
          <span class="time-zone">({t("plan.timeZone", { zone: view.timeZone })})</span>
        </dd>
        <dt>{t("plan.where")}</dt>
        <dd>{view.area.label}</dd>
        {view.distanceMeters !== undefined && (
          <>
            <dt>{t("plan.distance")}</dt>
            <dd>
              {formatKilometers(view.distanceMeters, language)} {t("unit.km")}
            </dd>
          </>
        )}
        {view.elevationGainMeters !== undefined && (
          <>
            <dt>{t("plan.elevation")}</dt>
            <dd>
              {formatNumber(view.elevationGainMeters, language)} {t("unit.m")}
            </dd>
          </>
        )}
        {view.pace !== undefined && (
          <>
            <dt>{paceStyleFor(view.activity) === "pace" ? t("plan.pace") : t("plan.speed")}</dt>
            <dd>{formatPaceBand(view.pace, view.activity, "metric", t)}</dd>
          </>
        )}
        <dt>{t("plan.group")}</dt>
        <dd>{t(`drop.${view.dropPolicy}`)}</dd>
      </dl>

      <p class="counts">
        {t("plan.counts", {
          participants: view.counts.participants,
          interested: view.counts.interested,
        })}
      </p>

      {view.note !== undefined && (
        <p class="note">
          <Linkified text={view.note} />
        </p>
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
          <p>{t(`status.${audience.view.ownResponse.kind}`)}</p>
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
          <RespondForm t={t} planId={view.id} state={props.respondForm} />
        ) : (
          <p class="notice">{t("respond.closed")}</p>
        ))}

      <p class="deletion">
        {t("plan.deletion", { date: formatDate(view.deleteAt, view.timeZone, language) })}
      </p>
    </article>
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
