// Real-layout checks on phone widths (Chromium): the date and time fields side by side on the create
// form, and the header menu sheet's preference rows. Runs in the default and minimal projects.
// Everything is checked on /new (the header is on every page), so no plan is created: those
// containers do not trust X-Forwarded-For, so one project shares one create limiter (5 burst).
// Rows stay on one line at 320 px: label and select, the Change button hidden by the script.
import { expect, test } from "@playwright/test";
import { person } from "./helpers.ts";

const WIDTHS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;

/** Pixels of tolerance for sub-pixel rounding. */
const SLACK = 3;

for (const viewport of WIDTHS) {
  test(`Create form and menu sheet fit a ${viewport.width} px phone`, async ({
    browser,
    baseURL,
  }) => {
    const problems: string[] = [];
    const { context, page } = await person(browser, baseURL ?? "", problems);
    await page.setViewportSize(viewport);

    // A string, as the e2e project has no DOM types.
    const overflow = () =>
      page.evaluate<{ scrollWidth: number; innerWidth: number }>(
        "({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })",
      );

    // Create form: date and time side by side, inside the screen, equally wide.
    await page.goto("/new");
    const date = await page.locator("#field-date").boundingBox();
    const time = await page.locator("#field-time").boundingBox();
    expect(date, "date input is rendered").not.toBeNull();
    expect(time, "time input is rendered").not.toBeNull();
    const dateBox = date as NonNullable<typeof date>;
    const timeBox = time as NonNullable<typeof time>;
    const formWidths = await overflow();
    expect(formWidths.scrollWidth, "create form scrolls sideways").toBeLessThanOrEqual(
      formWidths.innerWidth,
    );
    expect(dateBox.x).toBeGreaterThanOrEqual(0);
    expect(dateBox.x + dateBox.width, "date input right edge").toBeLessThanOrEqual(viewport.width);
    expect(timeBox.x + timeBox.width, "time input right edge").toBeLessThanOrEqual(viewport.width);
    expect(
      Math.abs(dateBox.width - timeBox.width),
      "date and time widths differ",
    ).toBeLessThanOrEqual(1);

    // Menu sheet, on the same page, opened through the burger.
    const burger = page.locator("button.burger");
    const burgerBox = await burger.boundingBox();
    expect(burgerBox?.width, "burger width").toBeGreaterThanOrEqual(44);
    expect(burgerBox?.height, "burger height").toBeGreaterThanOrEqual(44);
    await burger.click();
    const sheet = page.locator("#site-menu");
    await expect(sheet).toBeVisible();
    const rows = sheet.locator(".preference");
    await expect(rows).toHaveCount(3);

    const links = sheet.locator(".site-menu-links a");
    expect(await links.count(), "navigation links in the sheet").toBeGreaterThan(0);
    for (let index = 0; index < (await links.count()); index += 1) {
      const box = await links.nth(index).boundingBox();
      expect(box?.height, `link ${index} height`).toBeGreaterThanOrEqual(44);
    }

    for (let index = 0; index < 3; index += 1) {
      const row = rows.nth(index);
      const label = await row.locator("label").boundingBox();
      const select = await row.locator("select").boundingBox();
      expect(label, `row ${index} label is rendered`).not.toBeNull();
      expect(select, `row ${index} select is rendered`).not.toBeNull();
      const l = label as NonNullable<typeof label>;
      const s = select as NonNullable<typeof select>;
      const where = `preference row ${index} at ${viewport.width} px`;
      // The script hides the Change button; the row is label and select on one line.
      await expect(row.locator("button"), `${where}: Change button hidden`).toBeHidden();
      expect(
        Math.abs(s.y + s.height / 2 - (l.y + l.height / 2)),
        `${where}: label and select share a line`,
      ).toBeLessThanOrEqual(SLACK);
      expect(s.width, `${where}: select width`).toBeGreaterThanOrEqual(80);
      expect(s.height, `${where}: select height`).toBeGreaterThanOrEqual(44);
      expect(s.x + s.width, `${where}: select right edge`).toBeLessThanOrEqual(viewport.width);
    }

    const menuWidths = await overflow();
    expect(
      menuWidths.scrollWidth,
      "create page with open menu sheet scrolls sideways",
    ).toBeLessThanOrEqual(menuWidths.innerWidth);
    expect(problems).toEqual([]);
    await context.close();
  });
}
