// The form map (decisions D62, D66): mode switch, area and exact taps, the exact readout and
// "Find my location". Reads /new only, so no plan is created (the plans share a rate limit).
import { expect, test, type Page } from "@playwright/test";
import { openFold, person } from "./helpers.ts";

const EXACT_FOLD = "Exact meeting point";
const exactFold = (page: Page) =>
  page.locator("details.fold", { has: page.locator(".fold-title", { hasText: EXACT_FOLD }) });
const map = (page: Page) => page.locator(".map-picker .map");
const areaReadout = (page: Page) => page.locator("[data-area-readout]");
const fields = (page: Page) => ({
  areaLat: page.locator("#field-areaLat"),
  areaLng: page.locator("#field-areaLng"),
  exactLat: page.locator("#field-exactLat"),
  exactLng: page.locator("#field-exactLng"),
});

test("The switch starts on the public area; a tap sets the area, then the exact start with its readout and Remove", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "default settings",
    "needs the map, which the other project turns off",
  );
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/new");
  const f = fields(page);
  const area = page.getByRole("radio", { name: "Public area" });
  const exact = page.getByRole("radio", { name: "Exact start" });
  const caption = page.locator("[data-map-caption]");

  await expect(map(page)).toBeVisible();
  await expect(area).toBeChecked();
  await expect(page.locator(".mode-switch")).toBeVisible();
  await expect(page.getByText("Public area", { exact: true })).toBeVisible();
  await expect(caption).toHaveText(/public area \(about 1 km\)\. Everyone sees it\./);

  // A tap in the default mode sets the area point only.
  await map(page).click({ position: { x: 250, y: 200 } });
  await expect(f.areaLat).not.toHaveValue("");
  await expect(f.areaLng).not.toHaveValue("");
  await expect(f.exactLat).toHaveValue("");
  await expect(f.exactLng).toHaveValue("");
  await expect(exactFold(page)).not.toHaveAttribute("open", "");
  // The area point is set on the map, so its coordinate fields stay out of sight.
  await expect(f.areaLat).toBeHidden();
  await expect(areaReadout(page)).toContainText("Public area set on the map");

  // The exact start: its own mode, its own caption, then the fold with the readout.
  await page.locator(".mode-switch label", { hasText: "Exact start" }).click();
  await expect(exact).toBeChecked();
  await expect(caption).toHaveText(/exact start\. Only people who join can see it\./);
  await expect(caption).not.toContainText("accept");
  await map(page).click({ position: { x: 300, y: 230 } });
  await expect(f.exactLat).not.toHaveValue("");
  await expect(f.exactLng).not.toHaveValue("");
  await expect(exactFold(page)).toHaveAttribute("open", "");
  const readout = exactFold(page).locator("[data-exact-readout]");
  await expect(readout).toContainText("Point set on the map");
  await expect(f.exactLat).toBeHidden();
  await expect(f.exactLng).toBeHidden();
  await expect(f.exactLat).toBeAttached();
  // With an exact point the public area follows it: the area line is gone.
  await expect(areaReadout(page)).toBeHidden();

  // With an exact point the public area follows it: in area mode a tap changes nothing.
  const areaBefore = [await f.areaLat.inputValue(), await f.areaLng.inputValue()];
  await page.locator(".mode-switch label", { hasText: "Public area" }).click();
  await expect(caption).toHaveText(/public area follows the exact start/);
  await map(page).click({ position: { x: 200, y: 120 } });
  expect([await f.areaLat.inputValue(), await f.areaLng.inputValue()]).toEqual(areaBefore);

  // Remove clears both fields, shows the empty line and keeps focus on it.
  await readout.getByRole("button", { name: "Remove" }).click();
  await expect(readout.locator("[data-exact-none]")).toBeFocused();
  await expect(caption).toHaveText(/set the public area/);
  await expect(f.exactLat).toHaveValue("");
  await expect(f.exactLng).toHaveValue("");
  await expect(readout).toContainText("No point set on the map");
  await expect(readout.getByRole("button", { name: "Remove" })).toBeHidden();
  // The area point set earlier stays, and its line is back with it.
  await expect(f.areaLat).toHaveValue(areaBefore[0] ?? "");
  await expect(areaReadout(page)).toContainText("Public area set on the map");

  // Without the exact point a tap in area mode sets the area again.
  await map(page).click({ position: { x: 200, y: 120 } });
  await expect(f.areaLat).not.toHaveValue(areaBefore[0] ?? "");
  expect(problems).toEqual([]);
});

test("The public area line: a tap sets it, Remove clears both fields and focuses the empty line", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "default settings",
    "needs the map, which the other project turns off",
  );
  const { page } = await person(browser, baseURL ?? "", []);
  await page.goto("/new");
  const f = fields(page);
  const readout = areaReadout(page);
  await expect(readout).toContainText("No public area set on the map");
  await expect(readout.getByRole("button", { name: "Remove" })).toBeHidden();

  await map(page).click({ position: { x: 250, y: 200 } });
  await expect(readout).toContainText("Public area set on the map");
  await expect(f.areaLat).not.toHaveValue("");
  await expect(f.areaLng).not.toHaveValue("");

  await readout.getByRole("button", { name: "Remove" }).click();
  await expect(f.areaLat).toHaveValue("");
  await expect(f.areaLng).toHaveValue("");
  await expect(readout.locator("[data-area-none]")).toBeFocused();
  await expect(readout).toContainText("No public area set on the map");

  await map(page).click({ position: { x: 250, y: 200 } });
  await expect(f.areaLat).not.toHaveValue("");
  await expect(readout).toContainText("Public area set on the map");
});

test("Find my location moves the view only: no field changes, no point is set", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "default settings",
    "needs the map, which the other project turns off",
  );
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems, {
    context: {
      geolocation: { latitude: 48.1371, longitude: 11.5754, accuracy: 30 },
      permissions: ["geolocation"],
    },
  });
  await page.goto("/new");
  const f = fields(page);
  const locate = page.getByRole("button", { name: "Find my location" });

  // The opening view is the browser zone's region or Berlin (tile zoom 6), not the device's place.
  await expect(
    page.locator(".map-picker img.leaflet-tile[src*='/tiles/6/']").first(),
  ).toBeAttached();
  await expect(locate).toBeEnabled();
  const box = await locate.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await locate.click();
  await expect(
    page.locator(".map-picker img.leaflet-tile[src*='/tiles/15/']").first(),
  ).toBeAttached();
  for (const field of Object.values(f)) await expect(field).toHaveValue("");
  await openFold(page, EXACT_FOLD);
  await expect(page.locator("[data-exact-readout]")).toContainText("No point set on the map");
  await expect(page.locator("#field-areaLabel")).toHaveValue("");
  expect(problems).toEqual([]);
});

test("Find my location disables itself when the browser refuses", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "default settings",
    "needs the map, which the other project turns off",
  );
  const { page } = await person(browser, baseURL ?? "", []);
  await page.goto("/new");
  // By class: the accessible name changes to the reason once it is refused.
  const locate = page.locator("button.map-locate");
  await locate.click();
  await expect(locate).toBeDisabled();
  await expect(locate).toHaveAttribute("title", "Location access was refused");
  await expect(locate).toBeFocused();
  for (const field of Object.values(fields(page))) await expect(field).toHaveValue("");
});

// The tiles around a zone's center at zoom 6: the center's tile and its neighbours (the map is
// wider than one tile). Tokyo (35.65, 139.74) is tile 56/25, Berlin (52.52, 13.405) is 34/20.
for (const [zone, tiles, place] of [
  ["Asia/Tokyo", /\/tiles\/6\/5[567]\/2[456]\.png/, "Tokyo"],
  ["UTC", /\/tiles\/6\/3[345]\/(19|20|21)\.png/, "Berlin"],
] as const) {
  test(`The map opens on ${place} at zoom 6 for a browser in ${zone}, with no saved point`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "default settings",
      "needs the map, which the other project turns off",
    );
    const problems: string[] = [];
    const { page } = await person(browser, baseURL ?? "", problems, {
      context: { timezoneId: zone },
    });
    const tile = page.waitForRequest((request) => tiles.test(request.url()));
    await page.goto("/new");
    await tile;
    await expect(map(page)).toBeVisible();
    // Opening the form sets no point.
    for (const field of Object.values(fields(page))) await expect(field).toHaveValue("");
    expect(problems).toEqual([]);
  });
}

test("Without maps the coordinate fields stay and there is no map, switch or locate control", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "default settings",
    "the default project has the map; this checks the one without",
  );
  const { page } = await person(browser, baseURL ?? "", []);
  await page.goto("/new");
  await expect(page.locator("[data-map-picker]")).toHaveCount(0);
  await expect(page.locator(".mode-switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find my location" })).toHaveCount(0);
  await openFold(page, EXACT_FOLD);
  await expect(page.locator("#field-exactLat")).toBeVisible();
  await expect(page.locator("#field-exactLng")).toBeVisible();
  await expect(page.locator("[data-exact-readout]")).toHaveCount(0);
});
