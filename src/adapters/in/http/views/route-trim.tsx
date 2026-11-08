// "Hide the start and end of the route" next to GPX uploads (decision D13). Off by default:
// planned routes usually begin at the meeting point, which participants should see.
import type { Translate } from "../../../i18n/i18n.ts";
import { ROUTE_TRIM_OPTIONS } from "../../../../domain/route.ts";

export const ROUTE_TRIM_FIELD = "gpxTrim";

export function RouteTrimField({
  t,
  id,
  selected,
}: {
  t: Translate;
  id: string;
  selected: string;
}) {
  const label = (meters: number) =>
    meters === 0
      ? t("form.gpxTrimOff")
      : meters >= 1000
        ? t("form.gpxTrimKilometers", { km: String(meters / 1000) })
        : t("form.gpxTrimMeters", { meters: String(meters) });
  const current = selected === "" ? "0" : selected;
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
