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
  for (const label of document.querySelectorAll<HTMLElement>("[data-time-zone]")) {
    if (label.dataset.timeZone === zone) label.hidden = true;
  }
}
