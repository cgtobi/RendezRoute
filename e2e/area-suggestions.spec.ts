// The Where section (decisions D70, D77): the place search is merged into the Area field, the
// meeting-area name is suggested from the map, and the exact point's description is suggested from
// the exact point. Reads /new only, so no plan is created. The fake geocoder knows "Flaucher" for
// the search, answers a street address inside Munich for the area name ("Sendling" for the 48.11,
// 11.56 cell, "Giesing" for the others, "nothing found" elsewhere) and a street-level description
// (a named place and its road, plus a house number that must never show).
//
// Needs the map and the geocoder: the config runs this file in the "default settings" project only
// (decision D84). The tests share the app's geocode rate limit, so everything is answered in the
// browser except tests 1, 5 and 6, which make the only real server lookups (5 calls in total).
//
// "Nothing is sent" can only be shown by waiting. The suggestion lookups are debounced by 600 ms,
// so `quietWindow` waits that plus a margin; every other wait here is for a request, a
// response or a value.
import { expect, test, type Page } from "@playwright/test";
import { person } from "./helpers.ts";

const FAKES = "http://localhost:8080";
const map = (page: Page) => page.locator(".map-picker .map");
const area = (page: Page) => page.locator("#field-areaLabel");
const areaHint = (page: Page) => page.locator("[data-label-suggested]");
const description = (page: Page) => page.locator("#field-exactDescription");
const descriptionHint = (page: Page) => page.locator("[data-description-suggested]");
const searchButton = (page: Page) => page.getByRole("button", { name: "Search", exact: true });
const exactStart = (page: Page) => page.locator(".mode-switch label", { hasText: "Exact start" });
const onGrid = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

type Point = { lat: number; lng: number };

/**
 * The lookups are debounced by 600 ms; a request would have left by the end of this wait. The
 * margin of 400 ms is for a loaded machine (up to 5 workers in parallel).
 */
const DEBOUNCE_WINDOW_MS = 1000;
const quietWindow = (page: Page) => page.waitForTimeout(DEBOUNCE_WINDOW_MS);

/**
 * Two animation frames in the page: what the app does with an answer it already has runs within
 * them. Used after a response (a plain `await` of it is not enough to see what the page did).
 */
const settle = (page: Page) =>
  page.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );

/** Waits until the answer to a lookup (a route response) has fully arrived, then lets the page react. */
async function answered(
  page: Page,
  path: "/geocode/reverse" | "/geocode/describe",
  act: () => Promise<void>,
) {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === path);
  await act();
  await (await response).finished();
  await settle(page);
}

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

async function reverseSaw(): Promise<string[]> {
  return (await (await fetch(`${FAKES}/reverse-requests`)).json()) as string[];
}

/** Taps at an offset in pixels from the middle of the map. */
async function tap(page: Page, dx = 0, dy = 0) {
  const box = await map(page).boundingBox();
  if (box === null) throw new Error("no map");
  await map(page).click({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
}

/** Answers the place search in the browser. */
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
  await area(page).fill("Flaucher");
  await searchButton(page).click();
  await page.getByRole("button", { name: "Flaucher, Isar, Munich" }).click();
  await expect(area(page)).toHaveValue("Flaucher");
}

/** Records the lookups of one endpoint; real ones reach the server, else `answer` is the reply. */
async function recordLookups(
  page: Page,
  path: "reverse" | "describe",
  answer: (count: number) => { status?: number; json: unknown } | "real",
) {
  const bodies: Point[] = [];
  await page.route(`**/geocode/${path}`, async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}") as Point);
    const reply = answer(bodies.length);
    if (reply === "real") await route.continue();
    else await route.fulfill(reply);
  });
  return bodies;
}

const SENDLING = { json: { label: "Sendling, München" } } as const;

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
  await quietWindow(page);
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
  // The rest is answered in the browser.
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

test("A name or description the host typed or picked is never replaced and never looked up", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  const reverse = await recordLookups(page, "reverse", () => SENDLING);
  const describe = await recordLookups(page, "describe", () => ({
    json: { label: "Flaucher car park" },
  }));
  await mockSearch(page);
  await page.goto("/new");
  await pickFlaucher(page);
  await area(page).fill("");

  await test.step("the host types over our own area suggestion; later taps leave it alone", async () => {
    await tap(page);
    await expect(area(page)).toHaveValue("Sendling, München");
    await area(page).fill("My own place");
    await expect(areaHint(page)).toBeHidden();
    await tap(page, -150);
    await quietWindow(page);
    await expect(area(page)).toHaveValue("My own place");
    await expect(areaHint(page)).toBeHidden();
    expect(reverse).toHaveLength(1);
    // Public area mode: no exact point, so no description lookup either.
    await expect(description(page)).toHaveValue("");
    expect(describe).toEqual([]);
  });

  await test.step("a picked name is never looked up, in public area mode or in exact mode", async () => {
    // Searching again replaces the text by the new explicit choice; it then counts as the host's.
    await pickFlaucher(page);
    await tap(page, 150);
    await quietWindow(page);
    await expect(area(page)).toHaveValue("Flaucher");
    await expect(areaHint(page)).toBeHidden();
    expect(reverse).toHaveLength(1);
    await exactStart(page).click();
    await tap(page, -150, 60);
    // The empty description is looked up (once), the picked area name is not.
    await expect(description(page)).toHaveValue("Flaucher car park");
    await quietWindow(page);
    await expect(area(page)).toHaveValue("Flaucher");
    expect(reverse).toHaveLength(1);
    expect(describe).toHaveLength(1);
  });

  await test.step("a description the host typed from scratch is never looked up", async () => {
    await description(page).fill("Bench by the north gate");
    await tap(page, 7, 5);
    await quietWindow(page);
    await expect(description(page)).toHaveValue("Bench by the north gate");
    await expect(descriptionHint(page)).toBeHidden();
    expect(describe).toHaveLength(1);
  });

  await test.step("a description the host edited from our suggestion is never looked up", async () => {
    await description(page).fill("");
    await tap(page, 120, 60);
    await expect(description(page)).toHaveValue("Flaucher car park");
    await expect(descriptionHint(page)).toBeVisible();
    await description(page).fill("Bench by the south gate");
    await expect(descriptionHint(page)).toBeHidden();
    await tap(page, 150);
    await quietWindow(page);
    await expect(description(page)).toHaveValue("Bench by the south gate");
    await expect(descriptionHint(page)).toBeHidden();
    await expect(area(page)).toHaveValue("Flaucher");
    expect(reverse).toHaveLength(1);
    expect(describe).toHaveLength(2);
  });
});

test("A failing lookup is silent: the fields stay empty and no hint shows", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  const unavailable = { status: 503, json: { error: "unavailable" } };
  await recordLookups(page, "reverse", () => unavailable);
  await recordLookups(page, "describe", () => unavailable);
  await mockSearch(page);
  await page.goto("/new");
  await pickFlaucher(page);
  await area(page).fill("");

  await test.step("the area lookup fails", async () => {
    await answered(page, "/geocode/reverse", () => tap(page));
    await expect(area(page)).toHaveValue("");
    await expect(areaHint(page)).toBeHidden();
  });

  await test.step("in exact mode the area and the description lookups both fail", async () => {
    await exactStart(page).click();
    const reverseAnswered = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/geocode/reverse",
    );
    await answered(page, "/geocode/describe", () => tap(page, 150));
    await (await reverseAnswered).finished();
    await settle(page);
    await expect(area(page)).toHaveValue("");
    await expect(areaHint(page)).toBeHidden();
    await expect(description(page)).toHaveValue("");
    await expect(descriptionHint(page)).toBeHidden();
  });
});

test("A tap that gets a 503 or no name clears our earlier suggestion and its hint", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  let reverseAnswer: "name" | "503" | "none" = "name";
  let describeAnswer: string | null = "Flaucher car park";
  await page.route("**/geocode/reverse", (route) => {
    if (reverseAnswer === "503") {
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    }
    return route.fulfill({
      json: { label: reverseAnswer === "name" ? "Sendling, München" : null },
    });
  });
  await page.route("**/geocode/describe", (route) =>
    route.fulfill({ json: { label: describeAnswer } }),
  );
  await mockSearch(page);
  await page.goto("/new");
  await pickFlaucher(page);
  await area(page).fill("");
  await exactStart(page).click();

  // Both suggestions arrive from one tap in exact mode. The taps alternate between two points
  // (7, 5 and 150 px from the middle) that lie in different 0.01 degree cells.
  await tap(page, 7, 5);
  await expect(area(page)).toHaveValue("Sendling, München");
  await expect(areaHint(page)).toBeVisible();
  await expect(description(page)).toHaveValue("Flaucher car park");
  await expect(descriptionHint(page)).toBeVisible();

  await test.step("a 503 for the area name clears our area suggestion", async () => {
    reverseAnswer = "503";
    await tap(page, 150);
    await expect(area(page)).toHaveValue("");
    await expect(areaHint(page)).toBeHidden();
  });

  await test.step("no area name ({label: null}) clears it too", async () => {
    reverseAnswer = "name";
    await tap(page, 7, 5);
    await expect(area(page)).toHaveValue("Sendling, München");
    await expect(areaHint(page)).toBeVisible();
    reverseAnswer = "none";
    await tap(page, 150);
    await expect(area(page)).toHaveValue("");
    await expect(areaHint(page)).toBeHidden();
  });

  await test.step("an empty description answer empties our description suggestion, with its hint", async () => {
    describeAnswer = null;
    await tap(page, 7, 5);
    await expect(description(page)).toHaveValue("");
    await expect(descriptionHint(page)).toBeHidden();
  });
});

test("A tap fills the empty meeting area with the district and city, never the street; a new tap replaces our own suggestion", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems);
  const bodies = await recordLookups(page, "reverse", () => "real");
  await mockSearch(page);
  await page.goto("/new");
  await expect(areaHint(page)).toBeHidden();
  await pickFlaucher(page);
  await area(page).fill("");

  await tap(page);
  await expect(area(page)).toHaveValue("Sendling, München");
  await expect(areaHint(page)).toBeVisible();
  await expect(areaHint(page)).toHaveText("Suggested from the map. Change it if you like.");
  expect(await area(page).inputValue()).not.toMatch(/Road|12|Bayern/);
  expect(bodies).toEqual([{ lat: 48.11, lng: 11.56 }]);

  // Another tap replaces our own, unchanged suggestion.
  await tap(page, 150);
  await expect(area(page)).toHaveValue("Giesing, München");
  await expect(areaHint(page)).toBeVisible();
  expect(bodies).toHaveLength(2);
  for (const body of bodies) {
    expect(onGrid(body.lat)).toBe(true);
    expect(onGrid(body.lng)).toBe(true);
  }
  expect(
    (await reverseSaw()).every((line) => /^-?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?$/.test(line)),
  ).toBe(true);
  expect(problems).toEqual([]);
});

test("A tap in exact mode suggests the area from the rounded public point only, and the description from the exact point, and says so", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems);
  const reverse = await recordLookups(page, "reverse", () => "real");
  // Only the first description lookup reaches the server; the second is answered in the browser.
  const describe = await recordLookups(page, "describe", (count) =>
    count === 1 ? "real" : { json: { label: "Another place" } },
  );
  await mockSearch(page);
  await page.goto("/new");
  await expect(areaHint(page)).toBeHidden();
  await expect(descriptionHint(page)).toBeHidden();
  await pickFlaucher(page);
  await area(page).fill("");
  await exactStart(page).click();
  await tap(page, 7, 5);

  await test.step("the area name asks only for the rounded public point", async () => {
    await expect(area(page)).not.toHaveValue("");
    await expect(areaHint(page)).toBeVisible();
    const exactLat = await page.locator("#field-exactLat").inputValue();
    const exactLng = await page.locator("#field-exactLng").inputValue();
    expect(exactLat).not.toBe("");
    expect(reverse).toHaveLength(1);
    const [body] = reverse;
    expect(onGrid(body?.lat ?? Number.NaN)).toBe(true);
    expect(onGrid(body?.lng ?? Number.NaN)).toBe(true);
    // The exact point has more digits than the grid; none of them was sent.
    expect(Number(exactLat)).not.toBe(body?.lat);
    expect(Number(exactLng)).not.toBe(body?.lng);
    const sent = JSON.stringify(body);
    expect(sent).not.toContain(exactLat);
    expect(sent).not.toContain(exactLng);
    expect(
      (await reverseSaw()).every((line) => /^-?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?$/.test(line)),
    ).toBe(true);
  });

  await test.step("the description is suggested from the exact point, without a house number", async () => {
    await expect(description(page)).toHaveValue("Flaucher car park, Isarauen");
    await expect(descriptionHint(page)).toBeVisible();
    await expect(descriptionHint(page)).toHaveText(
      "Suggested from the map point. Change it if you like.",
    );
    expect(await description(page).inputValue()).not.toMatch(/12|Sendling|Bayern/);
    // The exact point, as set on the map, is what was looked up.
    const lat = await page.locator("#field-exactLat").inputValue();
    const lng = await page.locator("#field-exactLng").inputValue();
    expect(describe).toHaveLength(1);
    expect(describe[0]).toEqual({ lat: Number(lat), lng: Number(lng) });
    expect(await describeSaw()).toContain(`${lat},${lng}`);
  });

  await test.step("a new tap replaces our own suggestion; editing it makes it the host's", async () => {
    await tap(page, 120, 60);
    await expect(description(page)).toHaveValue("Another place");
    expect(describe).toHaveLength(2);
    await description(page).fill("Bench by the north gate");
    await expect(descriptionHint(page)).toBeHidden();
  });
  expect(problems).toEqual([]);
});

test("Remove cancels a lookup that is waiting for its debounce or already on its way", async ({
  browser,
  baseURL,
}) => {
  const { page } = await person(browser, baseURL ?? "", []);
  let requests = 0;
  let handled = (): void => undefined;
  const answerSent = new Promise<void>((resolve) => {
    handled = resolve;
  });
  await page.route("**/geocode/describe", async (route) => {
    requests += 1;
    // The answer is still on its way when Remove is clicked.
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({ json: { label: "Too late" } }).catch(() => undefined);
    handled();
  });
  await mockSearch(page);
  await page.goto("/new");
  await pickFlaucher(page);
  await exactStart(page).click();
  const remove = page.locator("[data-exact-readout]").getByRole("button", { name: "Remove" });

  // Removed while the debounce still runs: no request leaves.
  await tap(page);
  await remove.click();
  await quietWindow(page);
  expect(requests).toBe(0);

  // Removed while the answer is on its way: it fills nothing.
  await tap(page, 40, 20);
  await expect.poll(() => requests).toBe(1);
  await remove.click();
  await answerSent;
  await settle(page);
  await expect(description(page)).toHaveValue("");
  await expect(descriptionHint(page)).toBeHidden();
});
