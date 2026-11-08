// Place search (spec 3.9, decision D12): only on explicit submit, through the CSRF-protected server endpoint.
import { pickPlace } from "./places.ts";

interface Place {
  label: string;
  lat: number;
  lng: number;
}

export function initPlaceSearch(): void {
  for (const box of document.querySelectorAll<HTMLElement>("[data-place-search]")) {
    const form = box.closest("form");
    const input = box.querySelector<HTMLInputElement>("input");
    const button = box.querySelector<HTMLButtonElement>("button");
    const list = box.querySelector<HTMLUListElement>("ul");
    const status = box.querySelector<HTMLElement>("[data-status]");
    if (form === null || input === null || button === null || list === null || status === null)
      continue;
    box.hidden = false;
    const csrf = form.querySelector<HTMLInputElement>('input[name="_csrf"]')?.value ?? "";

    const run = async () => {
      list.replaceChildren();
      status.textContent = "";
      let places: Place[];
      try {
        const response = await fetch(box.dataset.endpoint ?? "", {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify({ q: input.value }),
        });
        if (!response.ok) throw new Error(String(response.status));
        places = ((await response.json()) as { places: Place[] }).places;
      } catch {
        status.textContent = box.dataset.unavailable ?? "";
        return;
      }
      if (places.length === 0) status.textContent = box.dataset.noResults ?? "";
      for (const place of places) {
        const item = document.createElement("li");
        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = "secondary";
        choose.textContent = place.label;
        choose.addEventListener("click", () => {
          pickPlace(form, place);
          list.replaceChildren();
        });
        item.append(choose);
        list.append(item);
      }
    };

    button.addEventListener("click", () => void run());
    // Enter searches instead of submitting the whole form.
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void run();
      }
    });
  }
}
