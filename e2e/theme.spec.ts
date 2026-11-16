// The theme switch in the header menu sheet (decisions D64, D68, I82): System, Light or Dark,
// applied at once without a Change button, remembered in a cookie. Reads /, so no plan is created.
import { expect, test, type Page } from "@playwright/test";
import { person } from "./helpers.ts";

/** The dark page colour, as the stylesheet states it. */
const DARK_BG = "rgb(18, 19, 22)";
const LIGHT_BG = "rgb(255, 255, 255)";

async function chooseTheme(page: Page, label: "System" | "Light" | "Dark") {
  const menu = page.locator("#site-menu");
  if (!(await menu.evaluate("(el) => el.matches(':popover-open')"))) {
    await page.locator("button.burger").click();
  }
  const form = menu.locator('form[action="/theme"]');
  // Picking a value submits the form at once (no Change button click); /theme redirects back.
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/theme" && r.status() < 400),
    page.waitForEvent("load"),
    form.locator("select").selectOption({ label }),
  ]);
}

const expectBackground = (page: Page, colour: string) =>
  expect(page.locator("body")).toHaveCSS("background-color", colour);

test("The theme switch overrides a light system, and System removes it", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems, {
    context: { colorScheme: "light" },
  });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expectBackground(page, LIGHT_BG);

  await chooseTheme(page, "Dark");
  await expect(page.locator('html[data-theme="dark"]')).toHaveCount(1);
  await expectBackground(page, DARK_BG);

  await chooseTheme(page, "System");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expectBackground(page, LIGHT_BG);

  expect(problems).toEqual([]);
  await context.close();
});

test("The theme switch overrides a dark system with Light", async ({ browser, baseURL }) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems, {
    context: { colorScheme: "dark" },
  });
  await page.goto("/");
  await expectBackground(page, DARK_BG);

  await chooseTheme(page, "Light");
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1);
  await expectBackground(page, LIGHT_BG);

  expect(problems).toEqual([]);
  await context.close();
});
