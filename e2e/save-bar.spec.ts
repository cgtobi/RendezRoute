// The host page's save bar (decision 006) on the phone viewport: untouched form, no bar; edit the
// title, the bar sticks to the bottom with Save where it was; Discard restores; saving works and
// the bar goes away; a chosen route file counts and Discard clears it (ADR 007); with the map, a
// tap in the full-screen form map counts while it is open and after Done, its mode switch alone
// does not, and Discard takes the point off the fields and the page map (ADR 008); a problem
// render shows the bar from the start; without JavaScript only the Save button shows.
//
// Then the route file in the host's "Save changes" (ADR 007), on the same plan: a chosen file is
// saved with the other edits, all or nothing, and cut at the meeting point of the same submission;
// a file that is not a route keeps the edits on the page and saves nothing; "Remove route…" is its
// own confirmed action; all of it also works without JavaScript. Runs once per project: default
// settings (the exact start is a map tap) and maps, geocoder and weather disabled (typed
// coordinates).
//
// Then, in the default project only, the plan map's full-screen view (ADR 008, map-full-checks.ts)
// on the same plan: the host uploads a route again (the route test removed its own), then the
// host, a participant and a viewer open the full-screen map.
//
// One plan for all tests: the default containers do not trust proxy headers, so every spec there
// shares one client and its burst of 5 plan creations (src/adapters/in/http/rate-limit.ts). Plans
// created per container: default settings: core-loop 1, save-bar 1, v05 2 = 4 (map-full uses this
// file's plan); maps off: core-loop 1, save-bar 1, v05 1, map-full 1 = 4. One left in each.
// The route uploads here count against the route limit (10): 4 in the default container.
// The tests run in order, and the later ones are skipped if the save bar test fails.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createPlan, fillHostName, openFold, person } from "./helpers.ts";
import {
  type FullMapPlan,
  hostOpensFullMap,
  participantAndViewer,
  showWhereIAm,
} from "./map-full-checks.ts";

test.describe.configure({ mode: "serial" });

/** The plan the save bar test created, and the host's cookies to act on it. */
let shared:
  | { planUrl: string; cookies: Awaited<ReturnType<BrowserContext["cookies"]>> }
  | undefined;

// Plain expressions: this project has no DOM types.
const position = (page: Page) =>
  page.evaluate<string>(`getComputedStyle(document.querySelector(".save-bar")).position`);
const sideways = (page: Page) =>
  page.evaluate<boolean>(
    `document.documentElement.scrollWidth > document.documentElement.clientWidth`,
  );

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).boundingBox();
  expect(found, `${selector} is rendered`).not.toBeNull();
  return found as NonNullable<typeof found>;
}

test("The save bar sticks while the form has changes, and Discard and Save clear it", async ({
  browser,
  baseURL,
}, testInfo) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/new");
  const planUrl = await createPlan(page, "Bar test run");
  const host = new URL(planUrl).pathname + "/host";

  await page.goto(host);
  const bar = page.locator(".save-bar");
  const save = page.getByRole("button", { name: "Save changes" });
  const discard = page.getByRole("button", { name: "Discard" });
  const unsaved = page.getByText("Unsaved changes");

  // Clean: the plain row, no status, no Discard.
  await expect(bar).not.toHaveAttribute("data-dirty", /.*/);
  await expect(unsaved).toBeHidden();
  await expect(discard).toBeHidden();
  expect(await position(page)).toBe("static");
  const before = await box(page, ".save-bar button[type=submit]");

  // Changed: sticky at the bottom of the viewport, Save has not moved sideways.
  await page.getByLabel("Title").fill("Bar test run, longer");
  await expect(bar).toHaveAttribute("data-dirty", "");
  await expect(unsaved).toBeVisible();
  await expect(discard).toBeVisible();
  expect(await position(page)).toBe("sticky");
  const after = await box(page, ".save-bar button[type=submit]");
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  const viewport = page.viewportSize();
  const barBox = await box(page, ".save-bar");
  expect(barBox.y + barBox.height, "bar bottom edge is the viewport's").toBeCloseTo(
    (viewport as NonNullable<typeof viewport>).height,
    0,
  );
  // Save and Discard are big enough to touch.
  expect((await box(page, ".save-bar button[type=submit]")).height).toBeGreaterThanOrEqual(44);
  expect((await box(page, ".save-bar-discard")).height).toBeGreaterThanOrEqual(44);
  expect(await sideways(page), "page scrolls sideways").toBe(false);

  // Undoing the edit by hand clears it as well.
  await page.getByLabel("Title").fill("Bar test run");
  await expect(bar).not.toHaveAttribute("data-dirty", /.*/);

  // Discard puts the loaded values back.
  await page.getByLabel("Title").fill("Something else");
  await fillHostName(page, "Zed");
  await discard.click();
  await expect(page.getByLabel("Title")).toHaveValue("Bar test run");
  await expect(page.getByLabel("Your name")).toHaveValue("Anna");
  await expect(bar).not.toHaveAttribute("data-dirty", /.*/);
  await expect(save).toBeFocused();

  // A chosen route file is a change too (ADR 007); Discard clears it and hides the trim choice.
  const file = page.locator("#field-gpx");
  const trim = page.locator("[data-gpx-trim]");
  await openFold(page, "Route, pace and note");
  await expect(trim).toBeHidden();
  await file.setInputFiles({
    name: "run.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(
      '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="48.1" lon="11.5"/><trkpt lat="48.2" lon="11.5"/></trkseg></trk></gpx>',
    ),
  });
  await expect(bar).toHaveAttribute("data-dirty", "");
  await expect(trim).toBeVisible();
  await discard.click();
  await expect(file).toHaveValue("");
  await expect(trim).toBeHidden();
  await expect(bar).not.toHaveAttribute("data-dirty", /.*/);
  await expect(save).toBeFocused();

  // The full-screen form map writes the page form's fields (ADR 008): a tap there is a change,
  // its own mode switch is not (the page's follows it, and `mapMode` is not a saved field).
  if (testInfo.project.name === "default settings") {
    const dialog = page.locator("dialog.map-dialog");
    const exactLat = page.locator("#field-exactLat");
    await page.getByRole("button", { name: "Show the map full screen" }).click();
    await expect(page.locator("dialog.map-dialog:modal")).toHaveCount(1);
    await dialog.locator(".mode-switch label", { hasText: "Exact start" }).click();
    await expect(dialog.getByRole("radio", { name: "Exact start" })).toBeChecked();
    await expect(page.locator("[data-save-bar]")).not.toHaveAttribute("data-dirty", /.*/);
    await dialog.locator(".map-dialog-map").click({ position: { x: 200, y: 260 } });
    await expect(exactLat).not.toHaveValue("");
    await expect(page.locator("[data-save-bar][data-dirty]")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("[data-save-bar][data-dirty]")).toHaveCount(1);
    await expect(page.locator(".map-picker path.map-exact")).toHaveCount(1);
    // Discard restores the empty point: the fields and the page map's markers.
    await discard.click();
    await expect(exactLat).toHaveValue("");
    await expect(page.locator("#field-exactLng")).toHaveValue("");
    await expect(page.locator(".map-picker path.map-exact")).toHaveCount(0);
    await expect(page.locator(".map-picker path.map-area")).toHaveCount(0);
    await expect(bar).not.toHaveAttribute("data-dirty", /.*/);
    await expect(save).toBeFocused();
  }

  // Saving works and the bar goes away.
  await page.getByLabel("Title").fill("Bar test run, saved");
  await save.click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Bar test run, saved");
  await expect(bar).not.toHaveAttribute("data-dirty", /.*/);
  await expect(unsaved).toBeHidden();
  expect(await sideways(page), "page scrolls sideways").toBe(false);

  // Problem state: the server's errors show the bar from the start, with a link to the field.
  // Spaces only: the browser accepts the required field, the server does not.
  await page.getByLabel("Title").fill("   ");
  await save.click();
  const problem = page.locator(".save-bar[data-problem]");
  await expect(problem).toBeVisible();
  await expect(problem).toHaveAttribute("data-dirty", "");
  await expect(problem.getByText("1 problem to fix")).toBeVisible();
  // The click does not wait for the page's stylesheet: the bar can be there before app.css applies.
  await expect.poll(() => position(page)).toBe("sticky");
  await problem.getByRole("link", { name: "Go to Title" }).click();
  await expect(page.getByLabel("Title")).toBeFocused();
  expect(await sideways(page), "page scrolls sideways").toBe(false);

  // Without JavaScript the page has only the Save button, as before.
  const plain = await person(browser, baseURL ?? "", problems, {
    context: { javaScriptEnabled: false },
  });
  // A new profile is not the host: the owner's cookie is needed, so copy it over.
  await plain.context.addCookies(await context.cookies());
  await plain.page.goto(host);
  await expect(plain.page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(plain.page.getByText("Unsaved changes")).toBeHidden();
  await expect(plain.page.getByRole("button", { name: "Discard" })).toBeHidden();
  expect(await position(plain.page)).toBe("static");
  expect(await sideways(plain.page), "page scrolls sideways").toBe(false);

  // The 422 of the problem render is the one expected console message.
  expect(problems.filter((problem) => !/status of 422/.test(problem))).toEqual([]);
  // Nothing of the route was saved here: the route test starts from "No route".
  shared = { planUrl, cookies: await context.cookies() };
  await plain.context.close();
  await context.close();
});

const ROUTE_FOLD = "Route, pace and note";

/** The route point at the meeting point: what the GPX file below writes, 5 decimals. */
const routePoint = (lat: string, lng: string) => ({
  lat: Math.round(Number(lat) * 1e5) / 1e5,
  lng: Number(Number(lng).toFixed(5)),
});

/**
 * A straight 40-point route north through the point (about 111 m between points), with its 21st
 * point at it (rounded to 5 decimals): cut at that meeting point, the route starts there. Without
 * the cut it would start about 2 km south of it (500 m hidden at the start by default).
 */
function routeThrough(lat: string, lng: string): Buffer {
  const base = Math.round(Number(lat) * 1e5);
  const points = Array.from(
    { length: 40 },
    (_, i) =>
      `<trkpt lat="${((base + (i - 20) * 100) / 1e5).toFixed(5)}" lon="${routePoint(lat, lng).lng.toFixed(5)}"><ele>${500 + i}</ele></trkpt>`,
  ).join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="e2e" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Run</name><trkseg>${points}</trkseg></trk></gpx>`,
  );
}

const routeFold = (page: Page) =>
  page.locator("details.fold", { has: page.locator(".fold-title", { hasText: ROUTE_FOLD }) });

async function chooseRoute(page: Page, buffer: Buffer, name = "run.gpx") {
  await openFold(page, ROUTE_FOLD);
  await page
    .getByLabel("Route (GPX file, optional)")
    .setInputFiles({ name, mimeType: "application/gpx+xml", buffer });
}

/** Opens "Remove route…" in the route fold and confirms it. */
async function removeRoute(page: Page) {
  await openFold(page, ROUTE_FOLD);
  await page.locator("details.remove-route > summary").click();
  await page.getByRole("button", { name: "Remove route", exact: true }).click();
}

test("The host saves a route with the other edits, keeps them on a bad file, and removes it", async ({
  browser,
  baseURL,
}, testInfo) => {
  if (shared === undefined) throw new Error("the save bar test above creates the plan");
  const withMaps = testInfo.project.name === "default settings";
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  // The host of the save bar test's plan: its cookies make this profile the host.
  await context.addCookies(shared.cookies);
  const planPath = new URL(shared.planUrl).pathname;
  const host = `${planPath}/host`;
  const download = page.getByRole("link", { name: "Download GPX" });
  const trim = page.locator("[data-gpx-trim]");
  let meeting = { lat: "48.12000", lng: "11.55000" };

  await test.step("Title, exact start and a file are saved together, the route cut at the new point", async () => {
    await page.goto(host);
    await page.getByLabel("Title").fill("Route test run, edited");
    if (withMaps) {
      // The exact start is a tap on the map (decision D66); the fields it writes are hidden.
      await page.getByRole("radio", { name: "Exact start" }).check();
      await page.locator(".map-picker .map").click();
      await expect(page.locator("#field-exactLat")).not.toHaveValue("");
      meeting = {
        lat: await page.locator("#field-exactLat").inputValue(),
        lng: await page.locator("#field-exactLng").inputValue(),
      };
    } else {
      await openFold(page, "Exact meeting point");
      await page.locator("#field-exactLat").fill(meeting.lat);
      await page.locator("#field-exactLng").fill(meeting.lng);
    }
    await openFold(page, ROUTE_FOLD);
    await expect(routeFold(page).locator("> summary")).toContainText("No route");
    // The trim choice shows only once a file is chosen.
    await expect(trim).toBeHidden();
    // A file over the server's limit is refused by the browser, with the message at the field.
    const message = () =>
      page.evaluate<string>(`document.querySelector("#field-gpx").validationMessage`);
    await chooseRoute(page, Buffer.alloc(5 * 1024 * 1024 + 1, " "), "big.gpx");
    await expect.poll(message).toBe("The file is larger than 5 MB.");
    await chooseRoute(page, routeThrough(meeting.lat, meeting.lng));
    await expect.poll(message).toBe("");
    await expect(trim).toBeVisible();
    await expect(page.locator(".save-bar")).toHaveAttribute("data-dirty", "");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Changes saved.")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Route test run, edited");
    await expect(routeFold(page).locator("> summary")).toContainText("Route added");
    // The distance was empty, so it follows the route.
    await expect(page.locator("#field-distanceKm")).toHaveValue(/^\d/);

    await page.goto(planPath);
    await expect(download).toHaveAttribute("href", `${planPath}/route.gpx`);
    const response = await page.request.get(`${planPath}/route.gpx`);
    expect(response.status()).toBe(200);
    const gpx = await response.text();
    const first = /<trkpt lat="([^"]+)" lon="([^"]+)"/.exec(gpx);
    expect(first, "the route has points").not.toBeNull();
    // It starts at the route point at the meeting point set in the same submission, not 2 km
    // south of it.
    const expected = routePoint(meeting.lat, meeting.lng);
    expect(Number(first?.[1])).toBeCloseTo(expected.lat, 5);
    expect(Number(first?.[2])).toBeCloseTo(expected.lng, 5);
  });

  await test.step("A file that is not a route saves nothing and keeps the edits on the page", async () => {
    await page.goto(host);
    await page.getByLabel("Title").fill("Never saved");
    await chooseRoute(page, Buffer.from("just some notes, no route"), "notes.gpx");
    await page.getByRole("button", { name: "Save changes" }).click();

    const problem = page.locator(".save-bar[data-problem]");
    await expect(problem).toBeVisible();
    await expect(problem.getByText("1 problem to fix")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Never saved");
    await expect(page.locator("#field-gpx-error")).toHaveText("This doesn't look like a GPX file.");
    // The file cannot be filled in again: the page says to choose it again.
    await expect(page.getByText("Choose the file again")).toBeVisible();
    // The link opens the fold by script: wait until the page's script has run.
    await page.waitForLoadState("load");
    await problem.getByRole("link", { name: "Go to Route (GPX file, optional)" }).click();
    await expect(page.locator("#field-gpx")).toBeFocused();

    await page.goto(host);
    await expect(page.getByLabel("Title")).toHaveValue("Route test run, edited");
    await expect(routeFold(page).locator("> summary")).toContainText("Route added");
  });

  await test.step("Remove route… asks once more, then the route is gone", async () => {
    await removeRoute(page);
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await expect(routeFold(page).locator("> summary")).toContainText("No route");
    await expect(page.locator("details.remove-route")).toHaveCount(0);
    await page.goto(planPath);
    await expect(page.getByRole("heading", { name: "Route test run, edited" })).toBeVisible();
    await expect(download).toHaveCount(0);
  });

  // Without JavaScript the trim choice is always there, and both actions are plain forms.
  const plain = await person(browser, baseURL ?? "", problems, {
    context: { javaScriptEnabled: false },
  });
  // A new profile is not the host: the owner's cookie is needed, so copy it over.
  await plain.context.addCookies(await context.cookies());

  await test.step("Without JavaScript a file is saved and removed as well", async () => {
    await plain.page.goto(host);
    await openFold(plain.page, ROUTE_FOLD);
    await expect(plain.page.locator("[data-gpx-trim]")).toBeVisible();
    await expect(plain.page.getByText("Only used for a file chosen above.")).toBeVisible();
    await chooseRoute(plain.page, routeThrough(meeting.lat, meeting.lng));
    await plain.page.getByRole("button", { name: "Save changes" }).click();
    await expect(plain.page.getByText("Changes saved.")).toBeVisible();
    await expect(routeFold(plain.page).locator("> summary")).toContainText("Route added");

    await removeRoute(plain.page);
    await expect(plain.page.getByText("Changes saved.")).toBeVisible();
    await expect(routeFold(plain.page).locator("> summary")).toContainText("No route");
  });

  // The 422 of the bad file is the one expected console message.
  expect(problems.filter((problem) => !/status of 422/.test(problem))).toEqual([]);
  await plain.context.close();
  await context.close();
});

/** The plan with its route again, for the full-screen map tests below (default project only). */
let fullMap: FullMapPlan | undefined;

test("The host uploads a route again and opens the plan map full screen: modal, over the header, keyboard, Escape and Close", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "default settings", "needs the map");
  if (shared === undefined) throw new Error("the save bar test above creates the plan");
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await context.addCookies(shared.cookies);
  const planPath = new URL(shared.planUrl).pathname;

  await test.step("Upload a route through the exact start the route test set", async () => {
    await page.goto(`${planPath}/host`);
    const lat = await page.locator("#field-exactLat").inputValue();
    const lng = await page.locator("#field-exactLng").inputValue();
    expect(lat, "the route test set an exact start").not.toBe("");
    await chooseRoute(page, routeThrough(lat, lng));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await expect(routeFold(page).locator("> summary")).toContainText("Route added");
    fullMap = {
      planUrl: shared?.planUrl ?? "",
      title: await page.getByLabel("Title").inputValue(),
      cookies: await context.cookies(),
    };
  });
  expect(problems).toEqual([]);
  await context.close();
  if (fullMap === undefined) throw new Error("no route");
  await hostOpensFullMap(browser, baseURL ?? "", fullMap);
});

test("A participant sees the exact start and the route full screen; a viewer only the area, without a route request", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "default settings", "needs the map");
  if (fullMap === undefined) throw new Error("the test above uploads the route");
  await participantAndViewer(browser, baseURL ?? "", fullMap);
});

test("Show where I am draws the position without sending it; a refusal disables the button", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "default settings", "needs the map");
  if (fullMap === undefined) throw new Error("the test above uploads the route");
  await showWhereIAm(browser, baseURL ?? "", fullMap);
});
