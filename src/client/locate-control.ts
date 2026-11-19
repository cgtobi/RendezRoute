// The device-position button on a map (decision D62, ADR 008): the form map's "Find my location"
// and the full-screen plan map's "Show where I am". It asks the browser once per press and hands
// the fix to the map; nothing here sends or stores the position.
import L from "leaflet";

/** The button's name and the two reasons it shows once the browser refuses or fails. */
export interface LocateTexts {
  title: string;
  denied: string;
  unavailable: string;
}

/** "Find my location" on the form map: a cached fix of up to five minutes is fine for the view. */
export const FIND_ME_OPTIONS: PositionOptions = { timeout: 10_000, maximumAge: 300_000 };

/** The texts from an element's `data-locate-title`, `-denied` and `-unavailable` attributes. */
export function locateTexts(element: HTMLElement, fallbackTitle: string): LocateTexts {
  return {
    title: element.dataset.locateTitle ?? fallbackTitle,
    denied: element.dataset.locateDenied ?? "Location access was refused",
    unavailable: element.dataset.locateUnavailable ?? "Your position is not available",
  };
}

/**
 * A 44 px button under the zoom buttons (48 px in the full-screen map, like its zoom buttons). A
 * press asks for the position once and calls `onFix`; a refusal or failure disables the button
 * for the map's life and says why. Nothing is added when the browser has no geolocation. Returns
 * the button, if any.
 */
export function addLocateControl(
  map: L.Map,
  texts: LocateTexts,
  onFix: (position: GeolocationPosition) => void,
  options: PositionOptions = FIND_ME_OPTIONS,
): HTMLButtonElement | undefined {
  if (!("geolocation" in navigator)) return undefined;
  const button = L.DomUtil.create("button", "map-locate");
  button.type = "button";
  button.title = texts.title;
  button.setAttribute("aria-label", texts.title);
  L.DomUtil.create("span", "map-locate-icon", button).setAttribute("aria-hidden", "true");
  const control = new L.Control({ position: "topleft" });
  control.onAdd = () => {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    container.append(button);
    L.DomEvent.disableClickPropagation(container);
    return container;
  };
  L.DomEvent.on(button, "click", () => {
    if (button.getAttribute("aria-disabled") === "true") return;
    navigator.geolocation.getCurrentPosition(
      onFix,
      (error) => {
        // Any failure (refused, no position, timeout) ends the control for the map's life.
        // aria-disabled, not disabled, so focus stays on the button instead of dropping to the
        // page; the click handler ignores it.
        const why = error.code === error.PERMISSION_DENIED ? texts.denied : texts.unavailable;
        button.setAttribute("aria-disabled", "true");
        button.title = why;
        button.setAttribute("aria-label", why);
      },
      options,
    );
  });
  control.addTo(map);
  return button;
}
