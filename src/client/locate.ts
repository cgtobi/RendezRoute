// "Use my location" (spec 3.9): fills coordinates where the browser allows geolocation.
import { pickPlace } from "./places.ts";

export function initLocate(): void {
  if (!("geolocation" in navigator)) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-locate]")) {
    const form = button.closest("form");
    if (form === null) continue;
    button.hidden = false;
    button.addEventListener("click", () => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          pickPlace(form, { lat: position.coords.latitude, lng: position.coords.longitude }),
        () => {
          button.disabled = true;
        },
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    });
  }
}
