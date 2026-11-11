// Nearby (decision D35): "Use my location" and the map set the viewer's place, rounded to the
// 0.02° grid before it enters the form, so the URL never holds more; neither sends the form by
// itself (spec 3.9: location only fills the form). A typed place is looked up through the place
// search endpoint first, so only its rounded point is sent; if that fails, the form goes as it is
// and the server looks it up.
import L from "leaflet";
import { nearbyCoordinate, readCoordinate } from "./geo.ts";
import { createMap, themeColor, tileLayer } from "./tiles.ts";

export function initNearby(): void {
  for (const form of document.querySelectorAll<HTMLFormElement>("form[data-nearby]")) {
    const lat = form.querySelector<HTMLInputElement>('input[name="lat"]');
    const lng = form.querySelector<HTMLInputElement>('input[name="lng"]');
    if (lat === null || lng === null) continue;
    const place = form.querySelector<HTMLInputElement>('input[name="place"]');
    const chosen = form.querySelector<HTMLElement>("[data-nearby-point]");
    let onPoint: ((at: L.LatLng | undefined) => void) | undefined;
    // Whether the typed place was looked up for this submit already.
    let looked = false;

    const setPoint = (latitude: number, longitude: number) => {
      lat.value = nearbyCoordinate(latitude);
      lng.value = nearbyCoordinate(longitude);
      if (place !== null) place.value = "";
      if (chosen !== null) chosen.hidden = false;
      onPoint?.(L.latLng(Number(lat.value), Number(lng.value)));
    };
    place?.addEventListener("input", () => {
      looked = false;
      lat.value = "";
      lng.value = "";
      if (chosen !== null) chosen.hidden = true;
      onPoint?.(undefined);
    });

    const locate = form.querySelector<HTMLButtonElement>("[data-nearby-locate]");
    if (locate !== null && "geolocation" in navigator) {
      locate.hidden = false;
      locate.addEventListener("click", () => {
        navigator.geolocation.getCurrentPosition(
          (position) => setPoint(position.coords.latitude, position.coords.longitude),
          () => {
            locate.disabled = true;
          },
          // A coarse fix is enough: it is rounded to about 2 km anyway.
          { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
        );
      });
    }

    const endpoint = form.dataset.geocode;
    if (place !== null && endpoint !== undefined) {
      form.addEventListener("submit", (event) => {
        if (looked || place.value.trim() === "") return;
        event.preventDefault();
        looked = true;
        void lookUp(endpoint, form.dataset.csrf ?? "", place.value).then((found) => {
          if (found !== undefined) setPoint(found.lat, found.lng);
          form.requestSubmit();
        });
      });
    }

    const container = form.querySelector<HTMLElement>("[data-nearby-map]");
    if (container !== null) {
      container.hidden = false;
      const start = [readCoordinate(lat.value, "lat"), readCoordinate(lng.value, "lng")] as const;
      const at =
        start[0] === undefined || start[1] === undefined ? undefined : L.latLng(start[0], start[1]);
      const map = createMap(container, container).setView(at ?? [20, 0], at === undefined ? 2 : 11);
      tileLayer(container).addTo(map);
      const marker = L.circleMarker([0, 0], {
        radius: 8,
        color: themeColor("--accent", "#2e5bff"),
        fillOpacity: 0.8,
      });
      onPoint = (point) => {
        if (point === undefined) marker.remove();
        else {
          marker.setLatLng(point).addTo(map);
          // From the device, the spot may be anywhere: bring it into view.
          if (!map.getBounds().contains(point)) map.setView(point, 11);
        }
      };
      onPoint(at);
      map.on("click", (event: L.LeafletMouseEvent) => setPoint(event.latlng.lat, event.latlng.lng));
    }
  }
}

/** The first place search result, or undefined when there is none or the search failed. */
async function lookUp(
  endpoint: string,
  csrf: string,
  query: string,
): Promise<{ lat: number; lng: number } | undefined> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ q: query }),
    });
    if (!response.ok) return undefined;
    const { places } = (await response.json()) as { places: { lat: number; lng: number }[] };
    return places[0];
  } catch {
    return undefined;
  }
}
