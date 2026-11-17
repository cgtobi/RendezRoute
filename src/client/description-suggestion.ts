// Suggesting the exact meeting point's description after a tap on the form map (decision D77).
// Unlike the area name this sends the EXACT point, through the server's own CSRF-protected
// endpoint; the privacy notice says so. Only after the point is set (a tap), never while typing.
// An empty or failed answer adds nothing; it only empties our own earlier, unchanged suggestion.
import { type Point, shouldSuggest } from "./geo.ts";
import { setField, showHint } from "./places.ts";

const DEBOUNCE_MS = 600;

export interface DescriptionSuggester {
  /** Looks up the exact point just set by a tap (debounced; the latest tap wins). */
  suggest(point: Point): void;
  /** Drops a pending or running lookup, for when the point is removed. */
  cancel(): void;
  /** Empties the description while it still holds our own unchanged suggestion (a removed point). */
  clearSuggestion(): void;
}

/**
 * Returns the suggester, or undefined when the page offers no lookups (no endpoint attribute: the
 * geocoder is off) or the form has no description field.
 */
export function createDescriptionSuggester(
  picker: HTMLElement,
  form: HTMLFormElement,
): DescriptionSuggester | undefined {
  const endpoint = picker.dataset.describeEndpoint;
  const field = form.querySelector<HTMLInputElement>('[name="exactDescription"]');
  if (endpoint === undefined || endpoint === "" || field === null) return undefined;
  const hint = form.querySelector<HTMLElement>("[data-description-suggested]");
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

  // A definitive "nothing here" must not leave our own text for another place: while the field
  // still holds our unchanged suggestion it is emptied; the host's text is never touched.
  const dropStale = () => {
    if (lastSuggestion === undefined || field.value !== lastSuggestion) return;
    lastSuggestion = undefined;
    setField(form, "exactDescription", "");
    showHint(hint, false);
  };

  /** The exact point as the form holds it now: a removed or moved point makes an answer stale. */
  const stillAt = (point: Point) =>
    Number(form.querySelector<HTMLInputElement>('[name="exactLat"]')?.value) === point.lat &&
    Number(form.querySelector<HTMLInputElement>('[name="exactLng"]')?.value) === point.lng;

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
      // Silent: the host types the description as before.
    }
    // An older answer never overwrites a newer tap, and nothing is filled for a removed point.
    if (signal.aborted || !stillAt(point)) return;
    if (typeof label !== "string" || label === "") return dropStale();
    // The host may have typed meanwhile.
    if (!shouldSuggest(field.value, lastSuggestion)) return;
    lastSuggestion = label;
    setField(form, "exactDescription", label);
    showHint(hint, true);
  };

  const cancel = () => {
    clearTimeout(timer);
    pending?.abort();
    pending = undefined;
  };

  return {
    cancel,
    clearSuggestion: dropStale,
    suggest(point) {
      cancel();
      if (!shouldSuggest(field.value, lastSuggestion)) return;
      timer = setTimeout(() => {
        if (!shouldSuggest(field.value, lastSuggestion)) return;
        pending = new AbortController();
        void lookup(point, pending.signal);
      }, DEBOUNCE_MS);
    },
  };
}
