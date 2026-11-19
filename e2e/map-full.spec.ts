// The plan map's full-screen view (ADR 008) without maps: no plan map, no template and no icon,
// on the plan page or the form (maps-off project; it creates its own plan there).
//
// The checks with the map (modal, keyboard, Escape and Close, the key per audience, one route
// request, "Show where I am", axe) are in map-full-checks.ts and run from save-bar.spec.ts on that
// spec's plan: the default containers share one burst of 5 plan creations between all their specs,
// and a plan of its own here used the last one (see the budget note in save-bar.spec.ts).
import { expect, test } from "@playwright/test";
import { openButton } from "./map-full-checks.ts";
import { fillHostName, inFiveDays, openFold, person } from "./helpers.ts";

/** The project whose app has maps, geocoder and weather turned off. */
const NO_MAP_PROJECT = "maps, geocoder and weather disabled";

test("Without maps there is no plan map and no full-screen icon, on the plan page or the form", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== NO_MAP_PROJECT, "the default project has the map");
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/new");
  await expect(openButton(page)).toHaveCount(0);
  await fillHostName(page, "Anna");
  await page.getByLabel("Title").fill("No map run");
  await page.getByLabel("Date").fill(inFiveDays());
  await page.getByLabel("Start time").fill("08:30");
  await page.locator("#field-areaLabel").fill("Flaucher, north end");
  await openFold(page, "Exact meeting point");
  await page.locator("#field-exactLat").fill("48.11070");
  await page.locator("#field-exactLng").fill("11.55820");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
  const planUrl = (await page.locator(".links .link-box a").textContent()) ?? "";
  await page.goto(planUrl);
  await expect(page.getByRole("heading", { name: "No map run" })).toBeVisible();
  await expect(page.locator("[data-plan-map]")).toHaveCount(0);
  await expect(page.locator("template[data-map-dialog]")).toHaveCount(0);
  await expect(openButton(page)).toHaveCount(0);
  expect(problems).toEqual([]);
  await context.close();
});
