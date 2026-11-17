// The Where section (decision D77): the place search is merged into the Area field, and the exact
// point's description is suggested from the map. Reads /new only, so no plan is created. The fake
// geocoder knows "Flaucher" for the search and answers a street-level description (a named place
// and its road, plus a house number that must never show) inside Munich.
import { expect, test, type Page } from "@playwright/test";
import { person } from "./helpers.ts";

const FAKES = "http://localhost:8080";
const map = (page: Page) => page.locator(".map-picker .map");
const area = (page: Page) => page.locator("#field-areaLabel");
const description = (page: Page) => page.locator("#field-exactDescription");
const descriptionHint = (page: Page) => page.locator("[data-description-suggested]");
const searchButton = (page: Page) => page.getByRole("button", { name: "Search", exact: true });

/** Counts the requests to the geocoder endpoints, whichever the page sends. */
function countGeocodeRequests(page: Page) {
  const seen: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/geocode")) seen.push(`${request.method()} ${pathname}`);
  });
  return seen;
}

async function describeSaw(): Promise<string[]> {
  return (await (await fetch(`${FAKES}/describe-requests`)).json()) as string[];
}

/** Taps at an offset in pixels from the middle of the map. */
async function tap(page: Page, dx = 0, dy = 0) {
  const box = await map(page).boundingBox();
  if (box === null) throw new Error("no map");
  await map(page).click({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
}

/** Answers the place search in the browser (the tests share the geocode rate limit). */
async function mockSearch(page: Page) {
  await page.route(
    (url) => url.pathname === "/geocode",
    (route) =>
      route.fulfill({
        json: { places: [{ label: "Flaucher, Isar, Munich", lat: 48.1107, lng: 11.5582 }] },
      }),
  );
}

/** Searches for Flaucher in the Area field and picks the result: the map moves to Munich. */
async function pickFlaucher(page: Page) {
  await mockSearch(page);
  await area(page).fill("Flaucher");
  await searchButton(page).click();
  await page.getByRole("button", { name: "Flaucher, Isar, Munich" }).click();
  await expect(area(page)).toHaveValue("Flaucher");
}

test.beforeEach(({ baseURL }, testInfo) => {
  void baseURL;
  test.skip(
    testInfo.project.name !== "default settings",
    "needs the map and the geocoder, which the other project turns off",
  );
});

test("The Area field is the search field: typing sends nothing, Enter and the magnifier search, a pick fills the name and the point", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems);
  const seen = countGeocodeRequests(page);
  await page.goto("/new");

  // One field, named Area; the old search field is gone.
  await expect(page.getByLabel("Find a place")).toHaveCount(0);
  await expect(area(page)).toHaveAttribute("autocomplete", "off");
  await expect(area(page)).toHaveAttribute("placeholder", "Search or type a name");
  await expect(page.getByLabel("Area", { exact: true })).toHaveCount(1);

  // Typing, key by key, sends nothing.
  await area(page).pressSequentially("Flauch", { delay: 40 });
  await page.waitForTimeout(1000);
  expect(seen).toEqual([]);

  // Enter searches (and does not submit the form); the results sit under the field.
  await area(page).fill("Flaucher");
  await area(page).press("Enter");
  const result = page.getByRole("button", { name: "Flaucher, Isar, Munich" });
  await expect(result).toBeVisible();
  expect(seen).toEqual(["POST /geocode"]);
  expect(new URL(page.url()).pathname).toBe("/new");
  await expect(page.locator(".place-search [data-status][role='status']")).toBeAttached();
  await expect(page.locator(".place-search .place-results button")).toHaveCount(1);

  // Picking replaces the text with the result's name and sets the public point.
  await result.click();
  // The rest is answered in the browser: the tests share the geocode rate limit.
  await mockSearch(page);
  await expect(area(page)).toHaveValue("Flaucher");
  await expect(page.locator("#field-areaLat")).toHaveValue("48.1107");
  await expect(page.locator("#field-areaLng")).toHaveValue("11.5582");
  await expect(result).toBeHidden();

  // The magnifier searches too; a pick replaces what was typed before.
  await area(page).fill("flaucher");
  await searchButton(page).click();
  await page.getByRole("button", { name: "Flaucher, Isar, Munich" }).click();
  await expect(area(page)).toHaveValue("Flaucher");
  expect(seen.filter((request) => request === "POST /geocode")).toHaveLength(2);
  expect(problems).toEqual([]);
});

test("A name the host typed is never overwritten by a suggestion; a picked result is", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  let reverse = 0;
  await page.route("**/geocode/reverse", (route) => {
    reverse += 1;
    return route.fulfill({ json: { label: "Sendling, München" } });
  });
  await page.goto("/new");
  await pickFlaucher(page);
  // A picked result counts as the host's text: a tap leaves it alone.
  await tap(page);
  await page.waitForTimeout(1000);
  await expect(area(page)).toHaveValue("Flaucher");
  expect(reverse).toBe(0);
  // Searching again replaces the text by the new explicit choice.
  await area(page).fill("Flaucher");
  await searchButton(page).click();
  await page.getByRole("button", { name: "Flaucher, Isar, Munich" }).click();
  await expect(area(page)).toHaveValue("Flaucher");
});

test("A tap in exact mode suggests the description from the exact point, and says so", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems);
  const bodies: { lat: number; lng: number }[] = [];
  await page.route("**/geocode/describe", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}") as { lat: number; lng: number });
    // Only the first reaches the server: the tests share the geocode rate limit.
    if (bodies.length === 1) await route.continue();
    else await route.fulfill({ json: { label: "Another place" } });
  });
  await page.goto("/new");
  await expect(descriptionHint(page)).toBeHidden();
  await pickFlaucher(page);

  // Public area mode: no exact point, no description lookup.
  await tap(page);
  await page.waitForTimeout(1000);
  await expect(description(page)).toHaveValue("");
  expect(bodies).toEqual([]);

  await page.locator(".mode-switch label", { hasText: "Exact start" }).click();
  await tap(page, 7, 5);
  await expect(description(page)).toHaveValue("Flaucher car park, Isarauen");
  await expect(descriptionHint(page)).toBeVisible();
  await expect(descriptionHint(page)).toHaveText(
    "Suggested from the map point. Change it if you like.",
  );
  expect(await description(page).inputValue()).not.toMatch(/12|Sendling|Bayern/);

  // The exact point, as set on the map, is what was looked up.
  const lat = await page.locator("#field-exactLat").inputValue();
  const lng = await page.locator("#field-exactLng").inputValue();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toEqual({ lat: Number(lat), lng: Number(lng) });
  expect(await describeSaw()).toContain(`${lat},${lng}`);

  // Our own suggestion is replaced by a new tap; editing it makes it the host's.
  await tap(page, 120, 60);
  await expect.poll(() => bodies.length).toBe(2);
  await description(page).fill("Bench by the north gate");
  await expect(descriptionHint(page)).toBeHidden();
  await tap(page, -120, -60);
  await page.waitForTimeout(1200);
  await expect(description(page)).toHaveValue("Bench by the north gate");
  expect(bodies).toHaveLength(2);
  expect(problems).toEqual([]);
});

test("A failed description lookup leaves the field alone", async ({ browser, baseURL }) => {
  const { page } = await person(browser, baseURL ?? "", []);
  await page.route("**/geocode/describe", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.goto("/new");
  await pickFlaucher(page);
  await page.locator(".mode-switch label", { hasText: "Exact start" }).click();
  const lookup = page.waitForRequest("**/geocode/describe");
  await tap(page);
  await lookup;
  await page.waitForTimeout(500);
  await expect(description(page)).toHaveValue("");
  await expect(descriptionHint(page)).toBeHidden();
});

test("An empty answer adds nothing; our own earlier suggestion is emptied, with its hint", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  let answer: string | null = "Flaucher car park";
  await page.route("**/geocode/describe", (route) => route.fulfill({ json: { label: answer } }));
  await page.goto("/new");
  await pickFlaucher(page);
  await page.locator(".mode-switch label", { hasText: "Exact start" }).click();
  await tap(page);
  await expect(description(page)).toHaveValue("Flaucher car park");
  await expect(descriptionHint(page)).toBeVisible();

  // A later point with no description empties our own unchanged text and hides the hint.
  answer = null;
  await tap(page, 120, 60);
  await expect(description(page)).toHaveValue("");
  await expect(descriptionHint(page)).toBeHidden();
});

test("A filled description is never looked up: no request at all", async ({ browser, baseURL }) => {
  const { page } = await person(browser, baseURL ?? "", []);
  const seen = countGeocodeRequests(page);
  await page.goto("/new");
  await pickFlaucher(page);
  await page.locator(".mode-switch label", { hasText: "Exact start" }).click();
  await page.locator("details.fold > summary").first().click();
  await description(page).fill("Bench by the north gate");
  const before = seen.length;
  await tap(page);
  await page.waitForTimeout(1200);
  expect(seen.slice(before).filter((request) => request.endsWith("/geocode/describe"))).toEqual([]);
  await expect(description(page)).toHaveValue("Bench by the north gate");
  await expect(descriptionHint(page)).toBeHidden();
});

test("Remove cancels a lookup that is waiting for its debounce or already on its way", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  let requests = 0;
  await page.route("**/geocode/describe", async (route) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ json: { label: "Too late" } }).catch(() => undefined);
  });
  await page.goto("/new");
  await pickFlaucher(page);
  await page.locator(".mode-switch label", { hasText: "Exact start" }).click();
  const remove = page.locator("[data-exact-readout]").getByRole("button", { name: "Remove" });

  // Removed while the debounce still runs: no request leaves.
  await tap(page);
  await remove.click();
  await page.waitForTimeout(1000);
  expect(requests).toBe(0);

  // Removed while the answer is on its way: it fills nothing.
  await tap(page, 40, 20);
  await expect.poll(() => requests).toBe(1);
  await remove.click();
  await page.waitForTimeout(2000);
  await expect(description(page)).toHaveValue("");
  await expect(descriptionHint(page)).toBeHidden();
});
