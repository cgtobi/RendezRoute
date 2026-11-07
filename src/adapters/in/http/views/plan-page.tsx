// Plan page (spec 5 feature 3). Renders only what the read model contains (spec 2a).
import type { Translate } from "../../../i18n/i18n.ts";
import type { PlanViewForPoster, PlanViewForViewer } from "../../../../application/plan-views.ts";
import { paceStyleFor } from "../../../../domain/activity.ts";
import {
  formatDate,
  formatDay,
  formatKilometers,
  formatNumber,
  formatPaceBand,
  formatTime,
} from "./format.ts";
import { Linkified } from "./linkify.tsx";

export function PlanPage(props: {
  t: Translate;
  language: string;
  /** Which read model this is decides what may be shown (spec 3.6). */
  audience:
    | { kind: "viewer"; view: PlanViewForViewer }
    | { kind: "poster"; view: PlanViewForPoster };
}) {
  const { t, language, audience } = props;
  const { view } = audience;
  const isPoster = audience.kind === "poster";
  const exactStart = audience.kind === "poster" ? audience.view.exactStart : undefined;

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

      {isPoster && <p class="notice">{t("plan.youAreHost")}</p>}

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

      {view.note !== undefined && (
        <p class="note">
          <Linkified text={view.note} />
        </p>
      )}

      {exactStart !== undefined && (
        <section class="exact-start">
          <h2>{t("plan.exactStart")}</h2>
          <p class="hint">{t("plan.exactStartPrivate")}</p>
          {exactStart.description !== undefined && (
            <p>
              <Linkified text={exactStart.description} />
            </p>
          )}
          {exactStart.point !== undefined && (
            <p>
              {exactStart.point.lat}, {exactStart.point.lng} ·{" "}
              <a href={`geo:${exactStart.point.lat},${exactStart.point.lng}`}>
                {t("plan.openMapsApp")}
              </a>{" "}
              ·{" "}
              <a
                href={`https://www.openstreetmap.org/?mlat=${exactStart.point.lat}&mlon=${exactStart.point.lng}#map=17/${exactStart.point.lat}/${exactStart.point.lng}`}
                rel="noopener noreferrer"
              >
                {t("plan.openStreetMap")}
              </a>
            </p>
          )}
        </section>
      )}

      <p class="deletion">
        {t("plan.deletion", { date: formatDate(view.deleteAt, view.timeZone, language) })}
      </p>
    </article>
  );
}
