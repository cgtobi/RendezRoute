// Suggesting the meeting-area name after a tap on the form map (decision D70). Only the rounded
// public point is ever sent, through the server's own CSRF-protected endpoint; a failure is silent.
import { type Point, shouldSuggest } from "./geo.ts";
import { setField, showHint } from "./places.ts";

const DEBOUNCE_MS = 600;

/**
 * Returns the function to call with the public point after a tap, or undefined when the page
 * offers no lookups (no endpoint attribute: the geocoder is off) or the form has no label field.
 */
export function createLabelSuggester(
  picker: HTMLElement,
  form: HTMLFormElement,
): (((point: Point) => void) & { cancel(): void }) | undefined {
  const endpoint = picker.dataset.suggestEndpoint;
  const field = form.querySelector<HTMLInputElement>('[name="areaLabel"]');
  if (endpoint === undefined || endpoint === "" || field === null) return undefined;
  const hint = form.querySelector<HTMLElement>("[data-label-suggested]");
  const csrf = form.querySelector<HTMLInputElement>('input[name="_csrf"]')?.value ?? "";

  let lastSuggestion: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: AbortController | undefined;

  // Any input that is not our own write makes the text the host's: the hint goes, and a later tap
  // leaves it alone.
  field.addEventListener("input", () => {
    if (field.value === lastSuggestion) return;
    lastSuggestion = undefined;
    showHint(hint, false);
  });

  // A tap that finds no name must not leave the name of the previous place: while the field still
  // holds our own unchanged text it is emptied again (it is required), else it is the host's.
  const dropStale = () => {
    if (lastSuggestion === undefined || field.value !== lastSuggestion) return;
    lastSuggestion = undefined;
    setField(form, "areaLabel", "");
    showHint(hint, false);
  };

  const lookup = async (point: Point, signal: AbortSignal) => {
    let label: unknown;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ lat: point.lat, lng: point.lng }),
        signal,
      });
      if (response.ok) label = ((await response.json()) as { label?: unknown }).label;
    } catch {
      // Silent: the host types the name as before.
    }
    // An older answer never overwrites a newer tap.
    if (signal.aborted) return;
    if (typeof label !== "string" || label === "") return dropStale();
    // The host may have typed meanwhile.
    if (!shouldSuggest(field.value, lastSuggestion)) return;
    lastSuggestion = label;
    setField(form, "areaLabel", label);
    showHint(hint, true);
  };

  const cancel = () => {
    clearTimeout(timer);
    pending?.abort();
    pending = undefined;
  };

  // `cancel` is for Remove: a lookup still on its way must not name a point that is gone.
  return Object.assign(
    (point: Point) => {
      cancel();
      if (!shouldSuggest(field.value, lastSuggestion)) return;
      timer = setTimeout(() => {
        if (!shouldSuggest(field.value, lastSuggestion)) return;
        pending = new AbortController();
        void lookup(point, pending.signal);
      }, DEBOUNCE_MS);
    },
    { cancel },
  );
}
