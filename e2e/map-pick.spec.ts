// The form map (decisions D62, D66): mode switch, area and exact taps, the exact readout and
// "Find my location". Reads /new only, so no plan is created (the plans share a rate limit).
import { expect, test, type Page } from "@playwright/test";
import { openFold, person } from "./helpers.ts";

/** The project whose app has maps, geocoder and weather turned off; the default and WebKit projects have the map. */
const NO_MAP_PROJECT = "maps, geocoder and weather disabled";

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
    testInfo.project.name === NO_MAP_PROJECT,
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
    testInfo.project.name === NO_MAP_PROJECT,
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
    testInfo.project.name === NO_MAP_PROJECT,
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
    testInfo.project.name === NO_MAP_PROJECT,
    "needs the map, which the other project turns off",
  );
  const { page } = await person(browser, baseURL ?? "", []);
  await page.goto("/new");
  // By class: the accessible name changes to the reason once it is refused.
  const locate = page.locator("button.map-locate");
  await locate.click();
  await expect(locate).toBeDisabled();
  await expect(locate).toHaveAttribute("title", "Location access was refused");
  // Safari does not focus a button on click (a WebKit limit), so there is no focus to keep.
  if (browser.browserType().name() !== "webkit") await expect(locate).toBeFocused();
  for (const field of Object.values(fields(page))) await expect(field).toHaveValue("");
});

// The tiles around a zone's center at zoom 6: the center's tile and its neighbours (the map is
// wider than one tile). Tokyo (35.65, 139.74) is tile 56/25. The fallback to Berlin (52.52, 13.405)
// for UTC or an unknown zone, and the browser zone's center, are asserted by the unit tests
// "opens on the browser zone's center at zoom 6" and "opens on Berlin at zoom 6 for UTC" in
// test/client/map-view.test.ts (decision D84); this one proves that the tiles really load there.
test("The map opens on Tokyo at zoom 6 for a browser in Asia/Tokyo, with no saved point", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name === NO_MAP_PROJECT,
    "needs the map, which the other project turns off",
  );
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems, {
    context: { timezoneId: "Asia/Tokyo" },
  });
  const tile = page.waitForRequest((request) =>
    /\/tiles\/6\/5[567]\/2[456]\.png/.test(request.url()),
  );
  await page.goto("/new");
  await tile;
  await expect(map(page)).toBeVisible();
  // Opening the form sets no point.
  for (const field of Object.values(fields(page))) await expect(field).toHaveValue("");
  expect(problems).toEqual([]);
});

test("Without maps the coordinate fields stay and there is no map, switch or locate control", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== NO_MAP_PROJECT,
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

// The form map's full-screen view (ADR 008): a modal dialog with its own mode switch, which starts
// as the page's and sets the page's; its taps write the same form fields as the page map. Its
// status line names the point that is set, and Remove point removes that one (lead decision 2).
test("The full-screen form map: its switch follows the page, taps set the points, Remove point and Done", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name === NO_MAP_PROJECT,
    "needs the map, which the other project turns off",
  );
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/new");
  const f = fields(page);
  const open = page.getByRole("button", { name: "Show the map full screen" });
  const dialog = page.locator("dialog.map-dialog");
  const dialogMap = dialog.locator(".map-dialog-map");
  // Its three texts are spans, two of them hidden: the inner text is the one shown.
  const status = dialog.locator("[data-point-status]");
  const remove = dialog.getByRole("button", { name: "Remove point" });
  const dialogMode = (name: string) => dialog.locator(".mode-switch label", { hasText: name });
  const openFull = async () => {
    await open.click();
    await expect(page.locator("dialog.map-dialog:modal")).toHaveCount(1);
    await expect(dialog.locator("img.leaflet-tile").first()).toBeVisible();
  };

  await test.step("Tapping the open icon sets nothing; the switch starts as the page's; Escape closes", async () => {
    const box = await open.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(48);
    expect(box?.height).toBeGreaterThanOrEqual(48);
    await openFull();
    for (const field of Object.values(f)) await expect(field).toHaveValue("");
    await expect(dialog.getByRole("radio", { name: "Public area" })).toBeChecked();
    await expect(dialog.locator("[data-map-caption]")).toHaveText(/set the public area/);
    await expect(status).toHaveText("No point set yet", { useInnerText: true });
    await expect(remove).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  await test.step("Exact start in the dialog: a tap fills it; Remove point empties it and focuses the line", async () => {
    await openFull();
    await dialogMode("Exact start").click();
    await expect(dialog.getByRole("radio", { name: "Exact start" })).toBeChecked();
    await expect(dialog.locator("[data-map-caption]")).toHaveText(/exact start\./);
    await dialogMap.click({ position: { x: 200, y: 260 } });
    await expect(f.exactLat).not.toHaveValue("");
    await expect(f.exactLng).not.toHaveValue("");
    await expect(f.areaLat).toHaveValue("");
    await expect(status).toHaveText("Exact start set", { useInnerText: true });
    await expect(dialog.locator("path.map-exact")).toHaveCount(1);
    await remove.click();
    await expect(f.exactLat).toHaveValue("");
    await expect(f.exactLng).toHaveValue("");
    await expect(status).toBeFocused();
    await expect(status).toHaveText("No point set yet", { useInnerText: true });
    await expect(remove).toBeHidden();
    await expect(dialog.locator("path.map-exact")).toHaveCount(0);
  });

  await test.step("An area tap while the exact start is set leaves the area as it was", async () => {
    await dialogMode("Public area").click();
    await dialogMap.click({ position: { x: 150, y: 220 } });
    await expect(f.areaLat).not.toHaveValue("");
    await expect(status).toHaveText("Public area set", { useInnerText: true });
    const area = [await f.areaLat.inputValue(), await f.areaLng.inputValue()];
    await dialogMode("Exact start").click();
    await dialogMap.click({ position: { x: 250, y: 320 } });
    await expect(f.exactLat).not.toHaveValue("");
    await expect(status).toHaveText("Exact start set", { useInnerText: true });
    await dialogMode("Public area").click();
    await expect(dialog.locator("[data-map-caption]")).toHaveText(/follows the exact start/);
    await dialogMap.click({ position: { x: 180, y: 380 } });
    await expect(status).toHaveText("Exact start set", { useInnerText: true });
    expect([await f.areaLat.inputValue(), await f.areaLng.inputValue()]).toEqual(area);
    // Back to the exact start: the page's switch follows it.
    await dialogMode("Exact start").click();
  });

  await test.step("Done: the focus is back on the icon, the page's switch and map show the same", async () => {
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    await expect(page.locator('.map-picker input[name="mapMode"][value="exact"]')).toBeChecked();
    await expect(page.locator(".map-picker path.map-exact")).toHaveCount(1);
    await expect(page.locator(".map-picker path.map-area")).toHaveCount(1);
    await expect(page.locator("[data-map-caption]")).toHaveText(/exact start\./);
    await expect(f.exactLat).not.toHaveValue("");
    await expect(f.areaLat).not.toHaveValue("");
  });

  await test.step("Set on the page, the switch opens as the page's: Public area, then Exact start", async () => {
    const pageMode = (name: string) =>
      page.locator(".map-picker .mode-switch label", { hasText: name });
    // Public area first: the page was left on Exact start by the dialog above.
    for (const [name, other] of [
      ["Public area", "Exact start"],
      ["Exact start", "Public area"],
    ] as const) {
      // The page's own switch, not the dialog's: the dialog is closed here.
      await pageMode(name).click();
      await expect(page.locator(".map-picker").getByRole("radio", { name })).toBeChecked();
      await openFull();
      await expect(dialog.getByRole("radio", { name })).toBeChecked();
      await expect(dialog.getByRole("radio", { name: other })).not.toBeChecked();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
    // Opening and closing set nothing.
    await expect(page.locator(".map-picker path.map-exact")).toHaveCount(1);
  });
  expect(problems).toEqual([]);
});
