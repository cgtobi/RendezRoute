// The plan map's full-screen view (ADR 008): a modal dialog opened by an icon on the page map.
// These checks run on save-bar.spec.ts's plan (its exact start, and a route uploaded again after
// that spec's route test removed its own), so the default containers' shared burst of 5 plan
// creations keeps one in reserve: see the budget note in save-bar.spec.ts. The host, a participant
// and a viewer open it. Checks: it is modal and over the sticky header, the page does not scroll,
// Escape and Close bring the focus back to the icon, the keyboard moves the map at once, closing it
// while a key or the wheel still pans or zooms it leaves no page error, the layers
// and the key follow what the page map has (spec 3.6), the route file is fetched once for the page
// and the dialog together, "Show where I am" shows the position without sending it, a refusal
// disables the button, axe passes inside it. Without maps there is no icon (map-full.spec.ts).
import AxeBuilder from "@axe-core/playwright";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { closeWhileTheMapMoves, person } from "./helpers.ts";

/** A plan with an exact start and a route, and its host's cookies. */
export interface FullMapPlan {
  planUrl: string;
  title: string;
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
}

/** As in the style guide spec: WCAG 2.0 to 2.2 A and AA, plus best practice. */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Known axe findings inside the dialog that are Leaflet's own markup, not ours (lead decision 5),
 * one entry per rule and selector, each with its reason. Empty: add nothing without a reason.
 */
const AXE_ALLOWED: readonly { rule: string; selector: string; reason: string }[] = [];

/** The width of the dialog map's focus frame (its ::after), "0px" without keyboard focus. */
const FOCUS_FRAME = `getComputedStyle(document.querySelector(".map-dialog .map-dialog-map"), "::after").borderTopWidth`;

export const openButton = (page: Page) =>
  page.getByRole("button", { name: "Show the map full screen" });
const dialog = (page: Page) => page.locator("dialog.map-dialog");
const keyEntries = (page: Page) =>
  page.locator(".map-dialog [data-legend]").filter({ visible: true });

/** The requests a page made for the route file, counted from now on. */
function countRouteRequests(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/route.geojson")) count += 1;
  });
  return () => count;
}

/** Opens the full-screen map and waits until its tiles show. */
async function openFull(page: Page): Promise<void> {
  await openButton(page).click();
  await expect(page.locator("dialog.map-dialog:modal")).toHaveCount(1);
  await expect(page.locator(".map-dialog img.leaflet-tile").first()).toBeVisible();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations, passes } = await new AxeBuilder({ page })
    .include("dialog.map-dialog")
    .withTags(AXE_TAGS)
    .analyze();
  expect(passes.length, "axe rules that passed").toBeGreaterThan(5);
  const unexpected = violations.flatMap((violation) =>
    violation.nodes
      .filter(
        (node) =>
          !AXE_ALLOWED.some(
            (allowed) =>
              allowed.rule === violation.id && node.target.join(" ").includes(allowed.selector),
          ),
      )
      .map(
        (node) =>
          `${violation.id} (${violation.impact ?? "n/a"}): ${violation.help}\n  target: ${node.target.join(" ")}\n  ${node.failureSummary ?? ""}`,
      ),
  );
  expect(unexpected, "axe violations").toEqual([]);
}

/** The left edge and the width of an element on screen, 0 when it is not rendered. */
async function edge(page: Page, selector: string): Promise<{ x: number; width: number }> {
  const box = await page.locator(selector).boundingBox();
  return { x: box?.x ?? 0, width: box?.width ?? 0 };
}

/** The host opens it: modal, over the header, keyboard, Escape and Close, the full key. */
export async function hostOpensFullMap(
  browser: Browser,
  baseURL: string,
  plan: FullMapPlan,
): Promise<void> {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL, problems);
  // The host's cookies make this profile the host, who sees the exact start and the route.
  await context.addCookies(plan.cookies);

  const routeRequests = countRouteRequests(page);
  await page.goto(plan.planUrl);
  // The page map draws the route first; the dialog reuses it.
  await expect(page.locator("[data-plan-map] path.map-route")).toHaveCount(1);
  const burger = await page.locator(".burger").boundingBox();
  expect(burger, "the burger is rendered").not.toBeNull();

  await test.step("Open: modal, the page locked and covered, the map focused", async () => {
    // The icon is a 48 px button on the page map, next to nothing that sets a point.
    const box = await openButton(page).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(48);
    expect(box?.height).toBeGreaterThanOrEqual(48);
    await openFull(page);
    await expect(dialog(page)).toHaveAttribute("aria-labelledby", "map-dialog-title");
    await expect(page.getByRole("dialog", { name: plan.title })).toBeVisible();
    // The head gives the start with the plan's time zone, shown or hidden as on the page (the
    // name is hidden only for a browser in that zone).
    const when = page.locator(".map-dialog .map-dialog-when");
    await expect(when).toContainText("08:30");
    const pageZone = page.locator(".when-where .time-zone");
    const dialogZone = when.locator(".time-zone");
    await expect(dialogZone).toHaveAttribute(
      "data-time-zone",
      (await pageZone.getAttribute("data-time-zone")) ?? "",
    );
    expect(await dialogZone.isHidden()).toBe(await pageZone.isHidden());
    await expect(page.locator(".map-dialog .map-dialog-map")).toBeFocused();
    // Opened with a pointer: no focus frame on the map.
    expect(await page.evaluate<string>(FOCUS_FRAME)).toBe("0px");
    expect(await page.evaluate<string>(`getComputedStyle(document.documentElement).overflow`)).toBe(
      "hidden",
    );
    // The top layer is above the sticky header: the burger's spot is the dialog's.
    const x = (burger?.x ?? 0) + (burger?.width ?? 0) / 2;
    const y = (burger?.y ?? 0) + (burger?.height ?? 0) / 2;
    expect(
      await page.evaluate<boolean>(
        `(document.elementFromPoint(${x}, ${y})?.closest("dialog.map-dialog") ?? null) !== null`,
      ),
    ).toBe(true);
    // The dialog fills the viewport.
    const size = page.viewportSize();
    const dialogBox = await dialog(page).boundingBox();
    expect(dialogBox?.width).toBeCloseTo(size?.width ?? 0, 0);
    expect(dialogBox?.height).toBeCloseTo(size?.height ?? 0, 0);
  });

  await test.step("The host sees the exact start, the route and a key of three", async () => {
    await expect(page.locator(".map-dialog path.map-exact")).toHaveCount(1);
    await expect(page.locator(".map-dialog path.map-route")).toHaveCount(1);
    await expect(page.locator(".map-dialog path.map-area")).toHaveCount(1);
    await expect(keyEntries(page)).toHaveText(["Public area", "Exact start", "Route"]);
    // The Close icon and "Show where I am" under the zoom buttons are 48 px targets.
    for (const name of ["Close full-screen map", "Show where I am"]) {
      const target = await page.getByRole("button", { name }).boundingBox();
      expect(target?.width, name).toBeGreaterThanOrEqual(48);
      expect(target?.height, name).toBeGreaterThanOrEqual(48);
    }
    await expectNoAxeViolations(page);
  });

  await test.step("Escape closes it: the dialog is gone, the focus is back on the icon", async () => {
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(openButton(page)).toBeFocused();
    expect(
      await page.evaluate<string>(`getComputedStyle(document.documentElement).overflow`),
    ).not.toBe("hidden");
  });

  await test.step("Close does the same", async () => {
    await openFull(page);
    await page.getByRole("button", { name: "Close full-screen map" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(openButton(page)).toBeFocused();
  });

  await test.step("Opened from the keyboard: the focus frame shows and the keys move the map at once", async () => {
    await page.keyboard.press("Enter");
    await expect(page.locator("dialog.map-dialog:modal")).toHaveCount(1);
    await expect(page.locator(".map-dialog .map-dialog-map")).toBeFocused();
    expect(await page.evaluate<string>(FOCUS_FRAME)).toBe("3px");
    // The view is settled: the route is drawn (the dialog opened on its bounds already).
    await expect(page.locator(".map-dialog path.map-route")).toHaveCount(1);
    await expect(page.locator(".map-dialog img.leaflet-tile").first()).toBeVisible();
    // ArrowRight pans east: the exact start's dot (a fixed 8 px radius) moves left by about 80 px.
    const exact = ".map-dialog path.map-exact";
    const before = await edge(page, exact);
    expect(before.width, "the exact start is drawn").toBeGreaterThan(0);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await edge(page, exact)).x).toBeLessThan(before.x - 40);
    // "+" zooms in: the public area's circle (a radius in metres) grows on screen.
    const area = ".map-dialog path.map-area";
    const small = await edge(page, area);
    await page.keyboard.press("+");
    await expect
      .poll(async () => (await edge(page, area)).width)
      .toBeGreaterThan(small.width * 1.5);
    await expect(page.locator(".map-dialog .map-dialog-map")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(openButton(page)).toBeFocused();
  });

  await test.step("Closed while a key or the wheel still moves the map: no page error", async () => {
    await closeWhileTheMapMoves(
      page,
      () => openFull(page),
      ["ArrowRight", "+", "-", "wheel in", "wheel out", "+", "ArrowLeft", "-"],
      problems,
    );
    await expect(openButton(page)).toBeFocused();
  });

  // One request for the page and all the opens together (lead decision 4).
  expect(routeRequests()).toBe(1);
  expect(problems).toEqual([]);
  await context.close();
}

/** A participant sees the exact start and the route; a viewer only the area, without a request. */
export async function participantAndViewer(
  browser: Browser,
  baseURL: string,
  plan: FullMapPlan,
): Promise<void> {
  const problems: string[] = [];

  const joiner = await person(browser, baseURL, problems);
  await joiner.page.goto(plan.planUrl);
  await joiner.page.getByLabel("Your name").fill("Ben");
  await joiner.page.getByRole("button", { name: "I'm in" }).click();
  await expect(joiner.page.getByRole("heading", { name: "Response saved" })).toBeVisible();
  const joinerRoutes = countRouteRequests(joiner.page);
  await joiner.page.getByRole("link", { name: "Back to the plan" }).click();
  await openFull(joiner.page);
  await expect(joiner.page.locator(".map-dialog path.map-exact")).toHaveCount(1);
  await expect(joiner.page.locator(".map-dialog path.map-route")).toHaveCount(1);
  await expect(keyEntries(joiner.page)).toHaveCount(3);
  expect(joinerRoutes()).toBe(1);

  const viewer = await person(browser, baseURL, problems);
  const viewerRoutes = countRouteRequests(viewer.page);
  await viewer.page.goto(plan.planUrl);
  await openFull(viewer.page);
  await expect(viewer.page.locator(".map-dialog path.map-area")).toHaveCount(1);
  await expect(viewer.page.locator(".map-dialog path.map-exact")).toHaveCount(0);
  await expect(viewer.page.locator(".map-dialog path.map-route")).toHaveCount(0);
  await expect(keyEntries(viewer.page)).toHaveText(["Public area"]);
  expect(viewerRoutes()).toBe(0);
  await expectNoAxeViolations(viewer.page);

  expect(problems).toEqual([]);
  await joiner.context.close();
  await viewer.context.close();
}

/** "Show where I am" draws the position without sending it; a refusal disables the button. */
export async function showWhereIAm(
  browser: Browser,
  baseURL: string,
  plan: FullMapPlan,
): Promise<void> {
  const problems: string[] = [];
  const position = { latitude: 48.12345, longitude: 11.54321, accuracy: 25 };

  await test.step("Granted: a dot and its accuracy circle, a status line, no request with the position", async () => {
    const { context, page } = await person(browser, baseURL, problems, {
      context: { geolocation: position, permissions: ["geolocation"] },
    });
    const sent: string[] = [];
    page.on("request", (request) => sent.push(`${request.url()} ${request.postData() ?? ""}`));
    await page.goto(plan.planUrl);
    await openFull(page);
    const showMe = page.getByRole("button", { name: "Show where I am" });
    const box = await showMe.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(48);
    expect(box?.height).toBeGreaterThanOrEqual(48);
    await showMe.click();
    await expect(page.locator(".map-dialog path.map-me")).toBeVisible();
    await expect(page.locator(".map-dialog path.map-me-accuracy")).toHaveCount(1);
    const status = page.locator(".map-dialog [data-map-status]");
    await expect(status).toHaveText("Your position is shown on the map.");
    // A second fix writes the line again (emptied first), so it is announced again.
    await showMe.click();
    await expect(status).toHaveText("Your position is shown on the map.");
    await expect(page.locator(".map-dialog path.map-me")).toHaveCount(1);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((line) => /48[.,]123|11[.,]543/.test(line))).toEqual([]);
    // Closing removes the position with the map.
    await page.keyboard.press("Escape");
    await expect(page.locator("path.map-me")).toHaveCount(0);
    await context.close();
  });

  await test.step("Refused: the button says why and is disabled, focus stays on it", async () => {
    const { context, page } = await person(browser, baseURL, problems);
    await page.goto(plan.planUrl);
    await openFull(page);
    // By class: the accessible name changes to the reason once it is refused.
    const showMe = page.locator(".map-dialog button.map-locate");
    await showMe.click();
    await expect(showMe).toHaveAttribute("aria-disabled", "true");
    await expect(showMe).toHaveAttribute("title", "Location access was refused");
    await expect(showMe).toHaveAttribute("aria-label", "Location access was refused");
    await expect(page.locator(".map-dialog path.map-me")).toHaveCount(0);
    await context.close();
  });

  expect(problems).toEqual([]);
}
