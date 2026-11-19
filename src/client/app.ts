// Small enhancements for every page (spec 2: bundled and served by the instance). Pages work
// without them; maps have their own bundle (map.ts), loaded only where needed.
import { initAutoSubmit } from "./auto-submit.ts";
import { initFoldSummaries } from "./fold-summaries.ts";
import { initPush } from "./push.ts";
import { initRouteFile } from "./route-file.ts";
import { initSelectOnFocus } from "./select-on-focus.ts";
import { initSaveBar } from "./save-bar.ts";
import { initShare } from "./share.ts";
import { initTimeDefault, initZones } from "./zone-fields.ts";

const start = () => {
  initAutoSubmit();
  initShare();
  initPush();
  initZones();
  initTimeDefault();
  initFoldSummaries();
  initSelectOnFocus();
  initRouteFile();
  // Last: it snapshots the form after the scripts above have prefilled it.
  initSaveBar();
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
