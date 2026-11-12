// "Hide the start and end of the route" next to GPX uploads (decisions D13, D40). 500 m by
// default, so a recording from home does not show it unless the host chooses so; ends cut at the
// meeting point are not hidden further.
import type { Translate } from "../../../i18n/i18n.ts";
import { DEFAULT_ROUTE_TRIM, ROUTE_TRIM_OPTIONS } from "../../../../domain/route.ts";
import { metersToDistance, type Units } from "../../../../domain/units.ts";

export const ROUTE_TRIM_FIELD = "gpxTrim";

export function RouteTrimField({
  t,
  id,
  selected,
  units,
}: {
  t: Translate;
  id: string;
  selected: string;
  units: Units;
}) {
  const label = (meters: number) =>
    meters === 0
      ? t("form.gpxTrimOff")
      : units === "imperial"
        ? t("form.gpxTrimMiles", { miles: Math.round(metersToDistance(meters, units) * 10) / 10 })
        : meters >= 1000
          ? t("form.gpxTrimKilometers", { km: String(meters / 1000) })
          : t("form.gpxTrimMeters", { meters: String(meters) });
  const current = selected === "" ? String(DEFAULT_ROUTE_TRIM) : selected;
  return (
    <div class="field">
      <label for={id}>{t("form.gpxTrim")}</label>
      <select id={id} name={ROUTE_TRIM_FIELD}>
        {ROUTE_TRIM_OPTIONS.map((meters) => (
          <option value={String(meters)} selected={current === String(meters)}>
            {label(meters)}
          </option>
        ))}
      </select>
      <p class="hint">{t("form.gpxTrimHint")}</p>
    </div>
  );
}
