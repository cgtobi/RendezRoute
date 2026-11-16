// Small enhancements for every page (spec 2: bundled and served by the instance). Pages work
// without them; maps have their own bundle (map.ts), loaded only where needed.
import { initAutoSubmit } from "./auto-submit.ts";
import { initFoldSummaries } from "./fold-summaries.ts";
import { initPush } from "./push.ts";
import { initShare } from "./share.ts";
import { initZones } from "./zone-fields.ts";

const start = () => {
  initAutoSubmit();
  initShare();
  initPush();
  initZones();
  initFoldSummaries();
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
