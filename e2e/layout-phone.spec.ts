// Real-layout checks on phone widths (Chromium): the date and time fields side by side on the create
// form, and the footer menu's preference rows. Runs in the default and minimal projects.
// Everything is checked on /new (the footer is on every page), so no plan is created: those
// containers do not trust X-Forwarded-For, so one project shares one create limiter (5 burst).
// 320 px exercises the stacked-label layout (label above the field), 390 px the one-line layout.
import { expect, test } from "@playwright/test";
import { person } from "./helpers.ts";

const WIDTHS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;

/** Pixels of tolerance for sub-pixel rounding. */
const SLACK = 3;

for (const viewport of WIDTHS) {
  test(`Create form and footer menu fit a ${viewport.width} px phone`, async ({
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

    // Footer menu, on the same page.
    await page.locator("footer.site-footer").scrollIntoViewIfNeeded();
    await page.locator("details.footer-menu > summary").click();
    const rows = page.locator("details.footer-menu .preference");
    await expect(rows).toHaveCount(2);

    for (let index = 0; index < 2; index += 1) {
      const row = rows.nth(index);
      const select = await row.locator("select").boundingBox();
      const button = await row.locator("button").boundingBox();
      expect(select, `row ${index} select is rendered`).not.toBeNull();
      expect(button, `row ${index} button is rendered`).not.toBeNull();
      const s = select as NonNullable<typeof select>;
      const b = button as NonNullable<typeof button>;
      const where = `preference row ${index} at ${viewport.width} px`;
      expect(
        Math.abs(s.y + s.height / 2 - (b.y + b.height / 2)),
        `${where}: select and button share a line`,
      ).toBeLessThanOrEqual(SLACK);
      expect(b.y + b.height, `${where}: button below the select`).toBeLessThanOrEqual(
        s.y + s.height + SLACK,
      );
      expect(s.width, `${where}: select width`).toBeGreaterThanOrEqual(80);
      expect(s.height, `${where}: select height`).toBeGreaterThanOrEqual(44);
      expect(b.height, `${where}: button height`).toBeGreaterThanOrEqual(44);
      const rowBox = await row.boundingBox();
      expect(b.width, `${where}: button width`).toBeLessThan(((rowBox?.width ?? 0) * 40) / 100);
      expect(b.x + b.width, `${where}: button right edge`).toBeLessThanOrEqual(viewport.width);
    }

    const menuWidths = await overflow();
    expect(
      menuWidths.scrollWidth,
      "create page with open menu scrolls sideways",
    ).toBeLessThanOrEqual(menuWidths.innerWidth);
    expect(problems).toEqual([]);
    await context.close();
  });
}
