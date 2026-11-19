// The palette choice in the header menu sheet (decision 005): Style row, applied at once without a
// Change button, remembered in a cookie across pages and reloads. Reads / and /privacy, so no plan
// is created. Runs on the phone viewport of the project.
import { expect, test, type Page } from "@playwright/test";
import { person } from "./helpers.ts";

async function chooseStyle(page: Page, label: string) {
  const menu = page.locator("#site-menu");
  // A plain expression: a function written as a string is never called, so it would read undefined.
  if (!(await page.evaluate(`document.getElementById("site-menu").matches(":popover-open")`))) {
    await page.locator("button.burger").click();
  }
  const form = menu.locator('form[action="/palette"]');
  // Picking a value submits the form at once (no Change button click); /palette redirects back.
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/palette" && r.status() < 400),
    page.waitForEvent("load"),
    form.locator("select").selectOption({ label }),
  ]);
}

// Plain expressions: this project has no DOM types, and a function written as a string is never called.
const bodyBackground = (page: Page) =>
  page.evaluate<string>(`getComputedStyle(document.body).backgroundColor`);
const accent = (page: Page) =>
  page.evaluate<string>(
    `getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()`,
  );

test("A palette picked in the menu applies, persists across pages and survives a reload", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems, {
    context: { colorScheme: "light" },
  });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-palette", /.*/);
  const before = await bodyBackground(page);
  const accentBefore = await accent(page);

  await page.locator("button.burger").click();
  const select = page.locator('#site-menu form[action="/palette"] select');
  await expect(select).toHaveValue("site");
  // Instant apply: no Change button with JavaScript.
  await expect(
    page.locator('#site-menu form[action="/palette"] button[type="submit"]'),
  ).toBeHidden();

  await chooseStyle(page, "Bold");
  await expect(page.locator('html[data-palette="bold"]')).toHaveCount(1);
  await expect(page.locator('link[href*="palettes/bold.css"]')).toHaveCount(1);
  const after = await bodyBackground(page);
  expect(after).not.toBe(before);
  expect(await accent(page)).not.toBe(accentBefore);

  // Another page, then a reload: the cookie keeps it.
  await page.goto("/privacy");
  await expect(page.locator('html[data-palette="bold"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('html[data-palette="bold"]')).toHaveCount(1);
  await expect(page.locator("body")).toHaveCSS("background-color", after);
  await page.locator("button.burger").click();
  await expect(select).toHaveValue("bold");

  // Site default clears the cookie and returns to the instance's colours.
  await chooseStyle(page, "Site default");
  await expect(page.locator("html")).not.toHaveAttribute("data-palette", /.*/);
  await expect(page.locator("body")).toHaveCSS("background-color", before);

  expect(problems).toEqual([]);
  await context.close();
});
