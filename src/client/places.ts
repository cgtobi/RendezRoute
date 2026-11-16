// Setting coordinates in the create/edit form, from the map or place search.
import { roundCoordinate, shortLabel } from "./geo.ts";

export interface PickedPlace {
  lat: number;
  lng: number;
  /** Place name from search; fills an empty area label. */
  label?: string;
}

export const PLACE_EVENT = "rendezroute:place";

/**
 * Search results describe the meeting area, never the exact start: they set the area point (like
 * the area label) and centre the form map, if there is one. The map's "Find my location" control
 * does not come through here: it only moves the view.
 */
export function pickPlace(form: HTMLFormElement, place: PickedPlace): void {
  setField(form, "areaLat", roundCoordinate(place.lat));
  setField(form, "areaLng", roundCoordinate(place.lng));
  form
    .querySelector<HTMLElement>("[data-map-picker]")
    ?.dispatchEvent(new CustomEvent<PickedPlace>(PLACE_EVENT, { detail: place }));
  const areaLabel = form.querySelector<HTMLInputElement>('[name="areaLabel"]');
  if (place.label !== undefined && areaLabel !== null && areaLabel.value.trim() === "") {
    areaLabel.value = shortLabel(place.label);
  }
}

export function setField(form: HTMLFormElement, name: string, value: string): void {
  const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (input === null) return;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
