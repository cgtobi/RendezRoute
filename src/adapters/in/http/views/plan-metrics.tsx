// A plan's measures inline (design decision D27): distance, elevation gain, and pace or speed, on
// the plan page and the template page.
import type { Child } from "hono/jsx";
import type { Translate } from "../../../i18n/i18n.ts";
import { paceStyleFor } from "../../../../domain/activity.ts";
import type { PlanDetails } from "../../../../domain/plan-edit.ts";
import type { Units } from "../../../../domain/units.ts";
import { formatDistance, formatElevation, formatPaceBand } from "./format.ts";

export function PlanMetrics(props: {
  t: Translate;
  details: Pick<PlanDetails, "activity" | "distanceMeters" | "elevationGainMeters" | "pace">;
  units: Units;
  language: string;
  /** Further entries after the measures, e.g. the plan page's drop policy. */
  children?: Child;
}) {
  const { t, details, units, language } = props;
  const metrics: { label: string; value: string }[] = [
    ...(details.distanceMeters === undefined
      ? []
      : [
          {
            label: t("plan.distance"),
            value: formatDistance(details.distanceMeters, units, language, t),
          },
        ]),
    ...(details.elevationGainMeters === undefined
      ? []
      : [
          {
            label: t("plan.elevation"),
            value: formatElevation(details.elevationGainMeters, units, language, t),
          },
        ]),
    ...(details.pace === undefined
      ? []
      : [
          {
            label: paceStyleFor(details.activity) === "pace" ? t("plan.pace") : t("plan.speed"),
            value: formatPaceBand(details.pace, details.activity, units, t),
          },
        ]),
  ];
  if (metrics.length === 0 && props.children === undefined) return null;
  return (
    <dl class="metrics">
      {metrics.map((metric) => (
        <div class="metric">
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
      {props.children}
    </dl>
  );
}
