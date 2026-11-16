// Applies the time zone logic to the page (decision P6).
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
  for (const label of document.querySelectorAll<HTMLElement>("[data-time-zone]")) {
    if (label.dataset.timeZone === zone) label.hidden = true;
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
