// The host page's save bar (decision 006): the form's submit button, plus what the page script
// adds while the form has unsaved changes. Status and Discard are in the markup with `hidden`, so
// without JavaScript there is only the Save button. With validation errors the server renders the
// bar in its problem state, from the start.
import type { MessageKey } from "../../../i18n/messages/en.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import type { FieldError, PlanField } from "../../../../domain/plan-input.ts";

/** What a field is called in "Go to ...", and where its link points (an id suffix). */
interface Target {
  label: MessageKey;
  /** The control's id suffix; fields without a control of their own link to their error line. */
  suffix: string;
}

const TARGETS: Readonly<Record<PlanField | "gpx", Target>> = {
  posterName: { label: "form.posterName", suffix: "posterName" },
  activity: { label: "form.activity", suffix: "activity" },
  title: { label: "form.title", suffix: "title" },
  note: { label: "form.note", suffix: "note" },
  date: { label: "form.date", suffix: "date" },
  time: { label: "form.time", suffix: "time" },
  timeZone: { label: "form.timeZone", suffix: "timeZone" },
  areaLabel: { label: "form.areaLabel", suffix: "areaLabel" },
  areaLat: { label: "form.areaCoordinates", suffix: "areaLat" },
  areaLng: { label: "form.areaCoordinates", suffix: "areaLng" },
  exactDescription: { label: "form.exactDescription", suffix: "exactDescription" },
  exactLat: { label: "form.latitude", suffix: "exactLat" },
  exactLng: { label: "form.longitude", suffix: "exactLng" },
  distanceKm: { label: "plan.distance", suffix: "distanceKm" },
  elevationGainM: { label: "plan.elevation", suffix: "elevationGainM" },
  paceFrom: { label: "plan.pace", suffix: "paceFrom" },
  paceTo: { label: "plan.pace", suffix: "paceTo" },
  dropPolicy: { label: "form.dropPolicy", suffix: "dropPolicy-error" },
  joinMode: { label: "form.joinMode", suffix: "joinMode-error" },
  visibility: { label: "form.visibility", suffix: "visibility-error" },
  primaryColor: { label: "form.primaryColor", suffix: "primaryColor" },
  secondaryColor: { label: "form.secondaryColor", suffix: "secondaryColor" },
  retentionDays: { label: "form.retention", suffix: "retentionDays" },
  recapWindow: { label: "form.recapWindow", suffix: "recapWindow" },
  keepAsTemplate: { label: "form.template", suffix: "template-error" },
  templateIncludePrivate: { label: "form.template", suffix: "template-error" },
  shareCopy: { label: "form.shareButtons", suffix: "shareButtons-error" },
  shareNative: { label: "form.shareButtons", suffix: "shareButtons-error" },
  shareWhatsApp: { label: "form.shareButtons", suffix: "shareButtons-error" },
  gpx: { label: "form.gpx", suffix: "gpx" },
};

/** The first invalid field's link and name, and how many fields have a problem. */
export function problemSummary(
  errors: readonly FieldError[],
  idPrefix: string,
  t: Translate,
): { count: number; href: string; field: string } | undefined {
  const first = errors[0];
  if (first === undefined) return undefined;
  const target = TARGETS[first.field];
  return {
    count: new Set(errors.map((error) => error.field)).size,
    href: `#${idPrefix}-${target.suffix}`,
    field: t(target.label),
  };
}

export function SaveBar({
  t,
  label,
  errors,
  idPrefix,
}: {
  t: Translate;
  label: string;
  errors: readonly FieldError[];
  idPrefix: string;
}) {
  const problem = problemSummary(errors, idPrefix, t);
  return (
    <div
      class="save-bar"
      data-save-bar=""
      data-dirty={problem === undefined ? undefined : ""}
      data-problem={problem === undefined ? undefined : ""}
    >
      <button type="submit">{label}</button>
      {problem === undefined ? (
        // A live region that stays in the page: the text inside appears and is announced politely.
        <div class="save-bar-status" role="status">
          <span data-save-bar-unsaved="" hidden>
            <span class="save-bar-dot" aria-hidden="true" />
            {t("saveBar.unsaved")}
          </span>
        </div>
      ) : (
        <div class="save-bar-status" role="alert">
          <span class="save-bar-problem">
            {t("saveBar.problems", { count: problem.count })}
            {" · "}
            <a href={problem.href} data-save-bar-goto="">
              {t("saveBar.goTo", { field: problem.field })}
            </a>
          </span>
        </div>
      )}
      <button type="button" class="secondary save-bar-discard" data-save-bar-discard="" hidden>
        {t("saveBar.discard")}
      </button>
    </div>
  );
}
