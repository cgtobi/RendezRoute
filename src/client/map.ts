// Browser entry point (spec 2: bundled and served by the instance). Every feature activates only
// when the server rendered its markup, which it does only when the feature is enabled.
import "leaflet/dist/leaflet.css";
import { initLocate } from "./locate.ts";
import { initNearby } from "./nearby.ts";
import { initPickMaps } from "./pick-map.ts";
import { initPlaceSearch } from "./place-search.ts";
import { initPlanMaps } from "./plan-map.ts";

const start = () => {
  initPickMaps();
  initPlaceSearch();
  initLocate();
  initPlanMaps();
  initNearby();
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
