// Place search merged into the area field (decisions D12, D77): the host's typed text is the public
// area name; only on an explicit Enter or a tap on the magnifier is that text sent to the
// CSRF-protected server endpoint. Typing sends nothing.
import { pickPlace } from "./places.ts";

interface Place {
  label: string;
  lat: number;
  lng: number;
}

/** The server refuses shorter queries (MIN_QUERY in src/application/places.ts). */
const MIN_QUERY = 2;

export function initPlaceSearch(): void {
  for (const box of document.querySelectorAll<HTMLElement>("[data-place-search]")) {
    const form = box.closest("form");
    const input = box.querySelector<HTMLInputElement>("input");
    const button = box.querySelector<HTMLButtonElement>("button");
    const list = box.querySelector<HTMLUListElement>("ul");
    const status = box.querySelector<HTMLElement>("[data-status]");
    if (form === null || input === null || button === null || list === null || status === null)
      continue;
    // The page is a plain required text field until here.
    button.hidden = false;
    for (const hint of box.querySelectorAll<HTMLElement>("[data-search-hint]")) hint.hidden = false;
    if (box.dataset.placeholder !== undefined) input.placeholder = box.dataset.placeholder;
    const csrf = form.querySelector<HTMLInputElement>('input[name="_csrf"]')?.value ?? "";

    // The text last sent to the search and the text a picked result wrote: Enter on either is the
    // host being done with the field, not asking for a search.
    let searched: string | undefined;
    let chosen: string | undefined;
    // A newer search or an edit makes an older answer stale.
    let generation = 0;

    const clear = () => {
      list.replaceChildren();
      status.textContent = "";
    };

    const run = async () => {
      const query = input.value.trim();
      if (Array.from(query).length < MIN_QUERY) {
        // Too short to search: put the host back in the field instead of doing nothing.
        input.focus();
        return;
      }
      const mine = ++generation;
      clear();
      searched = query;
      let places: Place[];
      try {
        const response = await fetch(box.dataset.endpoint ?? "", {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify({ q: query }),
        });
        if (!response.ok) throw new Error(String(response.status));
        places = ((await response.json()) as { places: Place[] }).places;
      } catch {
        if (mine === generation) status.textContent = box.dataset.unavailable ?? "";
        return;
      }
      if (mine !== generation) return;
      if (places.length === 0) status.textContent = box.dataset.noResults ?? "";
      for (const place of places) {
        const item = document.createElement("li");
        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = "secondary";
        choose.textContent = place.label;
        choose.addEventListener("click", () => {
          generation++;
          pickPlace(form, place);
          chosen = input.value;
          clear();
          input.focus();
        });
        item.append(choose);
        list.append(item);
      }
    };

    // Typing sends nothing: it only drops results that no longer match the text.
    input.addEventListener("input", () => {
      if (input.value === chosen) return;
      chosen = undefined;
      if (input.value.trim() !== searched) {
        generation++;
        clear();
      }
    });

    button.addEventListener("click", () => void run());
    // Enter searches instead of submitting the whole form, so a host who types a place and presses
    // Enter sees the results. The form is submitted as usual (Enter again) when the text is the
    // value a picked result wrote, has just been searched already (the host means the typed name),
    // or is too short to search (the browser then shows its "required" message).
    input.addEventListener("keydown", (event) => {
      // keyCode 229: Enter that confirms an input-method composition (some browsers).
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      const text = input.value.trim();
      if (Array.from(text).length < MIN_QUERY || input.value === chosen || text === searched)
        return;
      event.preventDefault();
      void run();
    });
  }
}
