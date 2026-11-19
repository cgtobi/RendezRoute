// Applies the time zone logic to the page (decision P6).
import { nextQuarterHour } from "./time-default.ts";
import { browserZone, detectedZone } from "./zones.ts";

/** Fills the create form's zone and hides plan zone labels that match the viewer's zone. */
export function initZones(): void {
  const zone = browserZone();
  for (const select of document.querySelectorAll<HTMLSelectElement>("select[data-detect-zone]")) {
    const pick = detectedZone({
      offered: [...select.options].map((option) => option.value),
      current: select.value,
      fallback: select.dataset.detectZone || select.value,
      browser: zone,
    });
    if (pick !== undefined) select.value = pick;
  }
  followZoneSelects();
  // Also inside the full-screen map's <template> (ADR 008), whose dialog head repeats the start.
  const roots: ParentNode[] = [
    document,
    ...[...document.querySelectorAll("template")].map((template) => template.content),
  ];
  for (const root of roots) {
    for (const label of root.querySelectorAll<HTMLElement>("[data-time-zone]")) {
      if (label.dataset.timeZone === zone) label.hidden = true;
    }
  }
}

/** Keeps the zone line's text ("Europe/Berlin · Change") in step with the select inside it. */
function followZoneSelects(): void {
  for (const line of document.querySelectorAll<HTMLElement>("details.zone-line")) {
    const select = line.querySelector<HTMLSelectElement>("select");
    const name = line.querySelector<HTMLElement>("[data-zone-name]");
    if (select === null || name === null) continue;
    const show = () => {
      name.textContent = select.value;
    };
    show();
    select.addEventListener("change", show);
  }
}

/**
 * Prefills an empty start time with the next quarter hour in the zone the form shows, so the
 * browser's picker does not open on an off-grid minute. Leaves filled, restored or flagged fields.
 * It runs once: picking another zone afterwards keeps the time the host sees.
 */
export function initTimeDefault(): void {
  const input = document.querySelector<HTMLInputElement>("form.plan-form #field-time");
  if (input === null || input.value !== "" || input.getAttribute("aria-invalid") === "true") return;
  const select = input.form?.querySelector<HTMLSelectElement>("#field-timeZone");
  const zone = select?.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
  input.value = nextQuarterHour(new Date(), zone);
}
