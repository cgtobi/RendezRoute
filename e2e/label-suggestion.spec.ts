// The meeting-area name suggested from the map (decision D70). Reads /new only, so no plan is
// created. The fake geocoder answers a street address inside Munich ("Sendling" for the 48.11,
// 11.56 cell, "Giesing" for the others) and "nothing found" elsewhere.
//
// Every default-project test comes from one client address and shares the app's geocode rate
// limit (burst of 10, then one per 6 s, for /geocode and /geocode/reverse together), with five
// workers in parallel. So the place search is always mocked here, and only the tests about the
// server path itself make real /geocode/reverse calls: the first test (2) and the exact-mode
// test (1). All others fulfil the lookup in the browser.
import { expect, test, type Page } from "@playwright/test";
import { person } from "./helpers.ts";

const FAKES = "http://localhost:8080";
const map = (page: Page) => page.locator(".map-picker .map");
const label = (page: Page) => page.locator("#field-areaLabel");
const hint = (page: Page) => page.locator("[data-label-suggested]");
const onGrid = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/** Taps at an offset in pixels from the middle of the map. */
async function tap(page: Page, dx = 0, dy = 0) {
  const box = await map(page).boundingBox();
  if (box === null) throw new Error("no map");
  await map(page).click({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
}

/** Records the lookups the page sends; real ones reach the server, else the browser answers. */
async function recordLookups(page: Page, { real = false } = {}) {
  const bodies: { lat: number; lng: number }[] = [];
  await page.route("**/geocode/reverse", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}") as { lat: number; lng: number });
    if (real) await route.continue();
    else await route.fulfill({ json: { label: "Sendling, München" } });
  });
  return bodies;
}

/** Puts the map on Munich (place search sets the area point) and, unless kept, empties the label. */
async function viewMunich(page: Page, { keepLabel = false } = {}) {
  // Exactly /geocode (the place search), not /geocode/reverse; answered in the browser.
  await page.route(
    (url) => url.pathname === "/geocode",
    (route) =>
      route.fulfill({
        json: { places: [{ label: "Flaucher, München, Bayern", lat: 48.1107, lng: 11.5582 }] },
      }),
  );
  await label(page).fill("Flaucher");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /Flaucher/ }).click();
  await expect(label(page)).toHaveValue("Flaucher");
  if (!keepLabel) await label(page).fill("");
}

async function fakeSaw(): Promise<string[]> {
  return (await (await fetch(`${FAKES}/reverse-requests`)).json()) as string[];
}

test.beforeEach(({ baseURL }, testInfo) => {
  void baseURL;
  test.skip(
    testInfo.project.name !== "default settings",
    "needs the map and the geocoder, which the other project turns off",
  );
});

test("A tap fills the empty meeting area with the district and city, never the street; a new tap replaces our own suggestion", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems);
  const bodies = await recordLookups(page, { real: true });
  await page.goto("/new");
  await expect(hint(page)).toBeHidden();
  await viewMunich(page);

  await tap(page);
  await expect(label(page)).toHaveValue("Sendling, München");
  await expect(hint(page)).toBeVisible();
  await expect(hint(page)).toHaveText("Suggested from the map. Change it if you like.");
  expect(await label(page).inputValue()).not.toMatch(/Road|12|Bayern/);
  expect(bodies).toEqual([{ lat: 48.11, lng: 11.56 }]);

  // Another tap replaces our own, unchanged suggestion.
  await tap(page, 150);
  await expect(label(page)).toHaveValue("Giesing, München");
  await expect(hint(page)).toBeVisible();
  expect(bodies).toHaveLength(2);
  for (const body of bodies) {
    expect(onGrid(body.lat)).toBe(true);
    expect(onGrid(body.lng)).toBe(true);
  }
  expect(
    (await fakeSaw()).every((line) => /^-?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?$/.test(line)),
  ).toBe(true);
  expect(problems).toEqual([]);
});

test("Typing their own text hides the hint and later taps leave it alone", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  const bodies = await recordLookups(page);
  await page.goto("/new");
  await viewMunich(page);
  await tap(page);
  await expect(label(page)).toHaveValue("Sendling, München");

  await label(page).fill("My own place");
  await expect(hint(page)).toBeHidden();
  await tap(page, -150);
  // The debounce is 600 ms: a lookup would have started by now.
  await page.waitForTimeout(1200);
  await expect(label(page)).toHaveValue("My own place");
  await expect(hint(page)).toBeHidden();
  expect(bodies).toHaveLength(1);
});

test("A filled meeting area is never looked up", async ({ browser, baseURL }) => {
  const { page } = await person(browser, baseURL ?? "", []);
  const bodies = await recordLookups(page);
  await page.goto("/new");
  await viewMunich(page, { keepLabel: true });
  await tap(page);
  await page.waitForTimeout(1200);
  await expect(label(page)).toHaveValue("Flaucher");
  await expect(hint(page)).toBeHidden();
  expect(bodies).toEqual([]);
});

test("In exact mode the area suggestion still asks only for the rounded public point", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  // The description lookup of the exact point (D77) is not what this test is about: answered here.
  await page.route("**/geocode/describe", (route) => route.fulfill({ json: { label: null } }));
  const bodies = await recordLookups(page, { real: true });
  await page.goto("/new");
  await viewMunich(page);
  await page.locator(".mode-switch label", { hasText: "Exact start" }).click();
  await tap(page, 7, 5);

  await expect(label(page)).not.toHaveValue("");
  await expect(hint(page)).toBeVisible();
  const exactLat = await page.locator("#field-exactLat").inputValue();
  const exactLng = await page.locator("#field-exactLng").inputValue();
  expect(exactLat).not.toBe("");
  expect(bodies).toHaveLength(1);
  const [body] = bodies;
  expect(onGrid(body?.lat ?? Number.NaN)).toBe(true);
  expect(onGrid(body?.lng ?? Number.NaN)).toBe(true);
  // The exact point has more digits than the grid; none of them was sent.
  expect(Number(exactLat)).not.toBe(body?.lat);
  expect(Number(exactLng)).not.toBe(body?.lng);
  const sent = JSON.stringify(body);
  expect(sent).not.toContain(exactLat);
  expect(sent).not.toContain(exactLng);
  expect(
    (await fakeSaw()).every((line) => /^-?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?$/.test(line)),
  ).toBe(true);
});

test("A failing lookup is silent: the field stays empty and no hint shows", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  await page.route("**/geocode/reverse", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.goto("/new");
  await viewMunich(page);
  const lookup = page.waitForRequest("**/geocode/reverse");
  await tap(page);
  await lookup;
  await page.waitForTimeout(500);
  await expect(label(page)).toHaveValue("");
  await expect(hint(page)).toBeHidden();
});

for (const failure of ["a 503", "no name ({label: null})"] as const) {
  test(`A tap that gets ${failure} clears our earlier suggestion and its hint`, async ({
    browser,
    baseURL,
  }) => {
    const { page } = await person(browser, baseURL ?? "", []);
    let failing = false;
    await page.route("**/geocode/reverse", async (route) => {
      if (!failing) return route.fulfill({ json: { label: "Sendling, München" } });
      return failure === "a 503"
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.fulfill({ status: 200, json: { label: null } });
    });
    await page.goto("/new");
    await viewMunich(page);
    await tap(page);
    await expect(label(page)).toHaveValue("Sendling, München");
    await expect(hint(page)).toBeVisible();

    failing = true;
    await tap(page, 150);
    await expect(label(page)).toHaveValue("");
    await expect(hint(page)).toBeHidden();
  });
}

test("A tap that finds nothing leaves a field the host edited untouched", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  await page.route("**/geocode/reverse", (route) => route.fulfill({ json: { label: null } }));
  await page.goto("/new");
  await viewMunich(page);
  await label(page).fill("My own place");
  const lookup = page.waitForRequest("**/geocode/reverse", { timeout: 3000 }).catch(() => null);
  await tap(page);
  // A filled, host-edited field sends no lookup at all; either way it keeps its text.
  await lookup;
  await page.waitForTimeout(500);
  await expect(label(page)).toHaveValue("My own place");
});
