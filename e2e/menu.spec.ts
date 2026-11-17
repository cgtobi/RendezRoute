// The header menu (decisions D68, I85, D64): a burger button opens a popover sheet, the header
// stays at the top, and the preference selects apply at once. Reads / only, so no plan is created.
import { expect, test, type Page } from "@playwright/test";
import { person } from "./helpers.ts";

// A closed popover is display: none, an open one is shown, so visibility is the open state; the
// assertions retry, which a one-shot evaluate would not.
const sheet = (page: Page) => page.locator("#site-menu");

test("The burger opens and closes the sheet; Escape and a tap outside close it", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/");
  const burger = page.locator("button.burger");

  await expect(sheet(page)).toBeHidden();
  await burger.click();
  await expect(sheet(page)).toBeVisible();
  await burger.click();
  await expect(sheet(page)).toBeHidden();

  await burger.click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(burger).toBeFocused();

  await burger.click();
  await expect(sheet(page)).toBeVisible();
  await page.mouse.click(5, 600);
  await expect(sheet(page)).toBeHidden();

  expect(problems).toEqual([]);
  await context.close();
});

test("The header stays at the top while the page scrolls", async ({ browser, baseURL }) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/new");
  await page.locator("footer.site-footer").scrollIntoViewIfNeeded();
  const header = await page.locator("header.site-header").boundingBox();
  expect(header?.y).toBe(0);
  await page.locator("button.burger").click();
  await expect(sheet(page)).toBeVisible();
  expect(problems).toEqual([]);
  await context.close();
});

test("Picking Imperial applies at once; the Change button is hidden", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/");
  await page.locator("button.burger").click();
  const form = page.locator('#site-menu form[action="/units"]');
  await expect(form.locator("button")).toBeHidden();
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/units" && r.status() < 400),
    page.waitForEvent("load"),
    form.locator("select").selectOption("imperial"),
  ]);
  await page.locator("button.burger").click();
  await expect(page.locator('#site-menu form[action="/units"] select')).toHaveValue("imperial");
  expect(problems).toEqual([]);
  await context.close();
});

test("Arrow keys on a closed select wait for Enter", async ({ browser, baseURL }) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/");
  await page.locator("button.burger").click();
  const select = page.locator('#site-menu form[action="/units"] select');
  await select.focus();
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  expect(posts, "no submit after an arrow key").toEqual([]);
  await Promise.all([page.waitForEvent("load"), page.keyboard.press("Enter")]);
  expect(posts.some((url) => new URL(url).pathname === "/units")).toBe(true);
  expect(problems).toEqual([]);
  await context.close();
});

test("Without JavaScript the Change button is visible and works", async ({ browser, baseURL }) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems, {
    context: { javaScriptEnabled: false },
  });
  await page.goto("/");
  const form = page.locator('#site-menu form[action="/units"]');
  await page.locator("button.burger").click();
  await expect(form.locator("button")).toBeVisible();
  await form.locator("select").selectOption("imperial");
  await Promise.all([page.waitForEvent("load"), form.locator("button").click()]);
  await page.locator("button.burger").click();
  await expect(page.locator('#site-menu form[action="/units"] select')).toHaveValue("imperial");
  expect(problems).toEqual([]);
  await context.close();
});

test("Tab from the burger enters the sheet", async ({ browser, baseURL }) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/");
  const burger = page.locator("button.burger");
  await burger.click();
  await expect(sheet(page)).toBeVisible();
  await expect(burger).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#site-menu :focus")).toHaveCount(1);
  expect(problems).toEqual([]);
  await context.close();
});

test("A map scrolling under the header never paints over the burger", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "default settings",
    "needs the map, which the other project turns off",
  );
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/new");
  const map = page.locator(".map").first();
  await expect(map.locator(".leaflet-pane").first()).toBeAttached();
  // Scroll until the map's attribution control (z-index 800, bottom right) sits at the burger's
  // centre, the one pane element that is hit-testable at that spot without loaded tiles.
  // The header sticks only once the page has scrolled past the dev banner above it.
  await page.evaluate(`window.scrollBy({ top: 200, behavior: "instant" })`);
  const burgerBox = await page.locator("button.burger").boundingBox();
  const attribution = await map.locator(".leaflet-control-attribution").boundingBox();
  expect(burgerBox, "burger box").not.toBeNull();
  expect(attribution, "attribution box").not.toBeNull();
  const b = burgerBox as NonNullable<typeof burgerBox>;
  const a = attribution as NonNullable<typeof attribution>;
  const delta = Math.round(a.y + a.height / 2 - (b.y + b.height / 2));
  // Strings, because the end-to-end project has no DOM types.
  await page.evaluate(`window.scrollBy({ top: ${delta}, behavior: "instant" })`);
  const top = await page.evaluate<string>(`(() => {
    const burger = document.querySelector("button.burger");
    if (burger === null) return "no burger";
    const box = burger.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cover = document.querySelector(".leaflet-control-attribution")?.getBoundingClientRect();
    if (cover === undefined || x < cover.left || x > cover.right || y < cover.top || y > cover.bottom)
      return "the attribution control is not under the burger";
    const hit = document.elementFromPoint(x, y);
    return hit !== null && burger.contains(hit) ? "burger" : String(hit?.className);
  })()`);
  expect(top).toBe("burger");
  expect(problems).toEqual([]);
  await context.close();
});
