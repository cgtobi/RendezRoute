// The theme switch in the footer menu (decisions D64, I82): System, Light or Dark, without
// JavaScript, remembered in a cookie. Reads /, so no plan is created.
import { expect, test, type Page } from "@playwright/test";
import { person } from "./helpers.ts";

/** The dark page colour, as the stylesheet states it. */
const DARK_BG = "rgb(18, 19, 22)";
const LIGHT_BG = "rgb(255, 255, 255)";

async function chooseTheme(page: Page, label: "System" | "Light" | "Dark") {
  const menu = page.locator("details.footer-menu");
  if ((await menu.getAttribute("open")) === null) {
    await page.locator("details.footer-menu > summary").click();
  }
  const form = menu.locator('form[action="/theme"]');
  await form.locator("select").selectOption({ label });
  // The form posts to /theme, which redirects back: wait for that navigation to finish.
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/theme" && r.status() < 400),
    page.waitForEvent("load"),
    form.locator("button").click(),
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
