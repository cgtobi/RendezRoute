// The one field style, "line and pen", and the red "Required" hint (decision D73, plan I90). Reads
// /new only, so no plan is created. The hint is pure CSS: it shows under an empty required field
// from the first render and is gone once the field has a value; under date and time it does not
// show on a fresh form (decision D74). Also the example placeholders and the disabled look.
//
// The checks are grouped by page state (decision D84): one test per group, one context and one
// page for it, a named step for each of the former tests. Text lines, folds, the time zone line,
// and the two map controls (default settings and WebKit only: the other project has no map).
import { expect, test, type Page } from "@playwright/test";
import { inFiveDays, person } from "./helpers.ts";

/**
 * The area line: the field itself, or, where the place search is merged into it (decision D77),
 * the row that draws the one underline for input and magnifier button. Document order puts the
 * row before its input, so the first match is the row where there is one.
 */
const AREA_LINE = ".inline-input.line-action:has(#field-areaLabel), #field-areaLabel";
const areaLine = (page: Page) => page.locator(AREA_LINE).first();

const hint = (page: Page, name: string) => page.locator(`#field-${name}-required`);

/** A computed style of the first element matching the selector. A plain expression: the browser has no DOM types here. */
const css = (page: Page, selector: string, property: string): Promise<string> =>
  page.evaluate<string>(
    `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`,
  );

test("Text lines: Required hint, 44 px line, placeholder, focus ring and forced colours", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/new");
  const area = page.locator("#field-areaLabel");

  await test.step("An example placeholder shows when empty, is gone when typing, and keeps the hint", async () => {
    const example = await area.getAttribute("placeholder");
    expect(example).toMatch(/Englischer Garten|Parc de la Tête d’Or|Search or type a name/);
    // Empty: the example is shown and a required field still shows its hint.
    await expect(area).toHaveValue("");
    expect(await area.evaluate((element) => element.matches(":placeholder-shown"))).toBe(true);
    await expect(hint(page, "areaLabel")).toBeVisible();
    // Typing replaces the example; the hint goes with it.
    await area.fill("Park");
    expect(await area.evaluate((element) => element.matches(":placeholder-shown"))).toBe(false);
    await expect(area).toHaveValue("Park");
    await expect(hint(page, "areaLabel")).toBeHidden();
    // Emptying brings both back; the example is never submitted as a value.
    await area.fill("");
    expect(await area.evaluate((element) => element.matches(":placeholder-shown"))).toBe(true);
    await expect(hint(page, "areaLabel")).toBeVisible();
  });
  await test.step("A required field without a default shows Required until it has text", async () => {
    // The area label is empty and required: the hint shows, in the danger colour, from the first render.
    await expect(area).toHaveValue("");
    await expect(hint(page, "areaLabel")).toBeVisible();
    await expect(hint(page, "areaLabel")).toHaveText("Required");
    await expect(hint(page, "areaLabel")).toHaveCSS("font-weight", "600");
    await expect(area).toHaveAttribute("aria-required", "true");
    // Described by its instruction hint only; the red hint is visual and aria-hidden (decision D74).
    await expect(area).toHaveAttribute("aria-describedby", "field-areaLabel-hint");
    await expect(hint(page, "areaLabel")).toHaveAttribute("aria-hidden", "true");
    // The line turns red while the hint shows: 2 px underline, no other border.
    const danger = await css(page, "#field-areaLabel-required", "color");
    expect(await css(page, AREA_LINE, "border-bottom-color")).toBe(danger);
    await expect(areaLine(page)).toHaveCSS("border-bottom-width", "2px");
    await expect(areaLine(page)).toHaveCSS("border-top-width", "0px");
    await expect(areaLine(page)).toHaveCSS("border-left-width", "0px");

    // Typing hides it; emptying the field shows it again.
    await area.fill("Park");
    await expect(hint(page, "areaLabel")).toBeHidden();
    await area.fill("");
    await expect(hint(page, "areaLabel")).toBeVisible();
    await area.fill("Park");

    // The title has a default, so it never shows the hint; emptying it does.
    await expect(page.locator("#field-title")).toHaveValue(/^(My plan|Mein Treffen|Ma sortie)$/);
    await expect(hint(page, "title")).toBeHidden();
    await page.locator("#field-title").fill("");
    await expect(hint(page, "title")).toBeVisible();
    await page.locator("#field-title").fill("Tempo");
    await expect(hint(page, "title")).toBeHidden();

    // Date and time have no hint element at all (decision D74); they stay required for assistive
    // technology through aria-required.
    await expect(hint(page, "date")).toHaveCount(0);
    await expect(hint(page, "time")).toHaveCount(0);
    await expect(page.locator("#field-date")).toHaveAttribute("aria-required", "true");
    await expect(page.locator("#field-time")).toHaveAttribute("aria-required", "true");
    await page.locator("#field-date").fill(inFiveDays());
    await page.locator("#field-time").fill("07:30");
    await expect(hint(page, "date")).toHaveCount(0);
    await expect(hint(page, "time")).toHaveCount(0);

    // Optional fields never show it, and the hint element exists only for required controls.
    await expect(page.locator(".required-hint:visible")).toHaveCount(1);
    await expect(hint(page, "posterName")).toBeVisible();
    await page.locator("#field-posterName").fill("Anna");
    await expect(page.locator(".required-hint:visible")).toHaveCount(0);
  });
  await test.step("A text field is a 44 px line, and a 2 px accent line on focus", async () => {
    // The steps before left text in the fields: back to empty and required, as on a fresh form.
    await area.fill("");
    // Empty and required, the field shows the 2 px danger line with its hint (decision D73).
    await expect(hint(page, "areaLabel")).toBeVisible();
    await expect(areaLine(page)).toHaveCSS("border-bottom-width", "2px");
    const danger = await css(page, "#field-areaLabel-required", "color");
    expect(await css(page, AREA_LINE, "border-bottom-color")).toBe(danger);

    // With a value and no focus, the resting line is 1 px. fill() leaves the field focused, which
    // would show the 2 px focus line, so blur it first.
    await area.fill("Park");
    await area.blur();
    await expect(hint(page, "areaLabel")).toBeHidden();
    const box = await area.boundingBox();
    expect(box?.height, "text field height").toBeGreaterThanOrEqual(44);
    expect(box?.height, "text field height").toBeLessThan(48);

    await expect(areaLine(page)).toHaveCSS("border-bottom-width", "1px");
    for (const side of ["top", "left", "right"]) {
      await expect(area).toHaveCSS(`border-${side}-width`, "0px");
    }
    await expect(areaLine(page)).toHaveCSS("border-top-left-radius", "0px");
    await expect(areaLine(page)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    // No pencil anywhere: the field is the line alone.
    await expect(page.locator(".line-pen, .icon-pencil")).toHaveCount(0);

    // Focus: a 2 px accent underline without changing the height.
    const rest = await css(page, AREA_LINE, "border-bottom-color");
    await area.focus();
    await expect(areaLine(page)).toHaveCSS("border-bottom-width", "2px");
    const focused = await css(page, AREA_LINE, "border-bottom-color");
    expect(focused).not.toBe(rest);
    // The focus line is the accent, not the danger colour (the hint is hidden: the field has text).
    expect(focused).not.toBe(danger);
    const after = await area.boundingBox();
    expect(after?.height).toBe(box?.height);
    // The underline is the only focus signal: no browser frame on the line field (option A).
    await expect(area).toHaveCSS("outline-style", "none");
    // Whatever takes the focus next (the magnifier, a button, a link) keeps a visible focus cue: the global ring,
    // or the accent line under a summary (decision D81).
    await page.keyboard.press("Tab");
    const cue = await page.evaluate<string>(
      `(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + " " + s.outlineWidth + " " + s.boxShadow; })()`,
    );
    expect(cue.startsWith("solid 3px") || /inset/.test(cue)).toBe(true);

    // The title keeps its large size and is a line as well.
    const title = page.locator("#field-title");
    await expect(title).toHaveCSS("border-bottom-width", /^[12]px$/);
  });
  await test.step("An empty required field and a field with an error keep a visible focus ring; a filled one shows only the accent underline", async () => {
    await area.fill("");
    const outline = () => css(page, "#field-areaLabel", "outline-style");
    // Empty and required: the danger line outranks the accent one, so the global ring stays.
    await area.focus();
    expect(await outline()).toBe("solid");
    // Filled: the accent underline is the only signal.
    await area.fill("Park");
    expect(await outline()).toBe("none");

    // A field with an error keeps the ring whatever it holds. The error state comes from the style
    // guide's "with errors" form (the same markup and CSS as a 422 page) instead of a real failed
    // submit: that POST counts against the create limiter, which every spec of a container shares
    // (one client address), so under a parallel run it can be answered 429 and never gives the 422.
    await page.goto("/styleguide");
    const invalid = page.locator(".field-invalid #sg-errors-areaLabel");
    await expect(invalid).toBeVisible();
    await invalid.fill("Park");
    // A key press first: after the mouse click the browser may not show a ring for script focus.
    await page.keyboard.press("Shift+Tab");
    await invalid.focus();
    // Read with retries: the focus state applies a frame later. "auto" is the browser's own ring,
    // which means our `:focus-visible { outline: 3px solid }` did not apply, and fails.
    const ring = () =>
      page.evaluate<string>(
        `(() => { const s = getComputedStyle(document.querySelector("#sg-errors-areaLabel")); return s.outlineStyle + " " + s.outlineWidth + " " + s.outlineColor; })()`,
      );
    await expect
      .poll(ring, { message: "focus ring of the invalid, filled field (style width colour)" })
      .toMatch(/^solid 3px /);
  });
  // Forced-colours emulation is Chromium's.
  if (browser.browserType().name() === "chromium") {
    await test.step("In forced colours a focused filled line field keeps an outline", async () => {
      await page.emulateMedia({ forcedColors: "active" });
      await page.goto("/new");
      await area.fill("Park");
      await page.keyboard.press("Shift+Tab");
      await area.focus();
      expect(await css(page, "#field-areaLabel", "outline-style")).toBe("solid");
      // The Highlight rule (2 px offset), not only the global ring (also 2 px but 3 px wide).
      expect(await css(page, "#field-areaLabel", "outline-offset")).toBe("2px");
      expect(await css(page, "#field-areaLabel", "outline-width")).toBe("2px");
    });
  }
  expect(problems).toEqual([]);
  await context.close();
});

test("Folds: the who fold, all folds alike, and forced colours on a summary", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/new");
  await test.step("The who fold shows its summary only while closed and hides the join group title when open", async () => {
    const fold = page.locator("details.fold-hide-open");
    await expect(fold).toHaveCount(1);
    const value = fold.locator("> summary .fold-value");
    await expect(value).toBeVisible();
    await fold.locator("> summary").click();
    await expect(fold).toHaveAttribute("open", "");
    await expect(value).not.toBeVisible();
    // The title stays; the summary's accessible name has no stray comma or summary text.
    await expect(fold.locator("> summary")).toHaveAccessibleName("Who can join and find it");
    // "Who can join" is not shown but still names its radio group; "Who can find" stays visible.
    // Visually hidden is a 1 px clipped box, which Playwright still counts as visible.
    const joinLegend = fold.locator("legend", { hasText: /^Who can join$/ });
    await expect(joinLegend).toHaveClass(/visually-hidden/);
    const legendBox = await joinLegend.boundingBox();
    expect(legendBox?.width ?? 99).toBeLessThanOrEqual(1);
    expect(legendBox?.height ?? 99).toBeLessThanOrEqual(1);
    await expect(fold.getByRole("group", { name: "Who can join" })).toBeVisible();
    await expect(fold.locator("#field-joinMode-hint")).toBeVisible();
    // Closing it brings the summary back.
    await fold.locator("> summary").click();
    await expect(value).toBeVisible();
  });
  await test.step("All folds look alike: one weight, no bar, and a focused summary shows a 2 px accent line, not a frame", async () => {
    const folds = page.locator("details.fold");
    expect(await folds.count()).toBeGreaterThanOrEqual(5);
    const looks = await page.evaluate<string[][]>(
      `Array.from(document.querySelectorAll("details.fold"), (f) => [
      getComputedStyle(f.querySelector(".fold-title")).fontWeight,
      getComputedStyle(f, "::before").content,
    ])`,
    );
    expect(new Set(looks.map((look) => look[0])).size).toBe(1);
    expect(looks.every((look) => look[1] === "none" || look[1] === "normal")).toBe(true);

    const summary = page.locator("details.fold").last().locator("> summary");
    await page.keyboard.press("Tab");
    await summary.focus();
    await expect(summary).toHaveCSS("outline-style", "none");
    const shadow = await page.evaluate<string>(
      `getComputedStyle(document.activeElement).boxShadow`,
    );
    expect(shadow).toMatch(/inset/);
    expect(shadow).toMatch(/0px -2px 0px 0px/);
    // A click shows the same cue, not the global frame.
    await summary.click();
    await expect(summary).toHaveCSS("outline-style", "none");
  });
  // Forced-colours emulation is Chromium's.
  if (browser.browserType().name() === "chromium") {
    await test.step("In forced colours a focused fold summary keeps a system outline inside its row", async () => {
      await page.emulateMedia({ forcedColors: "active" });
      await page.goto("/new");
      const summary = page.locator("details.fold").last().locator("> summary");
      await page.keyboard.press("Tab");
      await summary.focus();
      await expect(summary).toHaveCSS("outline-style", "solid");
      await expect(summary).toHaveCSS("outline-width", "2px");
      await expect(summary).toHaveCSS("outline-offset", "-2px");
    });
  }
  expect(problems).toEqual([]);
  await context.close();
});

test("The time zone line: Change and Done, and its title while closed", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/new");
  await test.step("The zone line says Change when closed and Done while open", async () => {
    const line = page.locator("details.zone-line");
    const summary = line.locator("> summary");
    // Both texts are in the markup and CSS hides one, so check what is visible, not the text content.
    await expect(summary.locator(".zone-change:visible")).toHaveCount(1);
    await expect(summary.locator(".zone-change:visible")).toHaveText("Change");
    await summary.click();
    await expect(line).toHaveAttribute("open", "");
    await expect(summary.locator(".zone-change:visible")).toHaveCount(1);
    await expect(summary.locator(".zone-change:visible")).toHaveText("Done");
    await summary.click();
    await expect(summary.locator(".zone-change:visible")).toHaveText("Change");
  });
  await test.step("The time zone line has a visible title while closed and drops it when open", async () => {
    const line = page.locator("details.zone-line");
    const summary = line.locator("> summary");
    const title = summary.locator(".zone-title");
    // What is shown, with the flex items' line breaks read as spaces.
    const lineText = async () => (await summary.innerText()).replace(/\s+/g, " ").trim();
    await expect(title).toBeVisible();
    await expect(title).toHaveText("Time zone:");
    await expect.poll(lineText).toMatch(/^Time zone: \S+ · Change$/);
    // The zone name has the text colour, the title the muted colour of the line.
    const colours = await page.evaluate<string[]>(
      `[getComputedStyle(document.querySelector(".zone-title")).color, getComputedStyle(document.querySelector("[data-zone-name]")).color]`,
    );
    expect(colours[0]).not.toBe(colours[1]);
    await summary.click();
    await expect(title).not.toBeVisible();
    await expect.poll(lineText).toMatch(/^\S+ · Done$/);
    await expect(page.getByLabel("Time zone", { exact: true })).toBeVisible();
  });
  expect(problems).toEqual([]);
  await context.close();
});

// The map is turned off in the other project (the config leaves this test out there).
test("Map-related field styles: the magnifier on the area line and the map's Remove button", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/new");
  await test.step("The place search button is a magnifier on the line: named Search, 44 px, one underline", async () => {
    const row = page.locator(".place-search .inline-input.line-action");
    // The merged area field (decision D77): the magnifier sits on the area input's own line.
    await expect(row.locator("#field-areaLabel")).toHaveCount(1);
    const button = row.getByRole("button", { name: "Search" });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(button.locator(".icon-search")).toBeVisible();
    // One shared underline: the row has it, the input inside has none. Empty and required, the
    // line is the 2 px danger line with the Required hint under the row; with text it rests at 1 px.
    await expect(row).toHaveCSS("border-bottom-width", "2px");
    await expect(row.locator("input")).toHaveCSS("border-bottom-width", "0px");
    await expect(hint(page, "areaLabel")).toBeVisible();
    await row.locator("input").fill("Park");
    await row.locator("input").blur();
    await expect(hint(page, "areaLabel")).toBeHidden();
    await expect(row).toHaveCSS("border-bottom-width", "1px");
    await expect(row.locator("input")).toHaveCSS("border-bottom-width", "0px");
    await row.locator("input").focus();
    await expect(row).toHaveCSS("border-bottom-width", "2px");
    await expect(row.locator("input")).toHaveCSS("border-bottom-width", "0px");
  });
  await test.step("The map's Remove button is a quiet muted x: named Remove, 44 px, no box, removes the point", async () => {
    // A fresh form: the step before typed into the area field.
    await page.goto("/new");
    await page.locator(".map-picker .map").click({ position: { x: 250, y: 200 } });
    const readout = page.locator("[data-area-readout]");
    const button = readout.getByRole("button", { name: "Remove" });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(button.locator(".icon-close")).toBeVisible();
    // No box: transparent, no border; muted at rest, accent on hover.
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(button).toHaveCSS("border-top-width", "0px");
    const muted = await css(page, "[data-area-remove]", "color");
    const accent = await page.evaluate<string>(
      "(() => { const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; })()",
    );
    expect(muted).not.toBe(accent);
    await button.hover();
    await expect(button).toHaveCSS("color", accent);
    // The status text takes the remaining width: the button sits at the end of the line.
    const line = await readout.locator("[data-area-set]").boundingBox();
    expect((line?.x ?? 0) + (line?.width ?? 0) - ((box?.x ?? 0) + (box?.width ?? 0))).toBeLessThan(
      2,
    );
    await button.click();
    await expect(page.locator("#field-areaLat")).toHaveValue("");
    await expect(page.locator("#field-areaLng")).toHaveValue("");
    await expect(readout.locator("[data-area-none]")).toBeFocused();
  });
  expect(problems).toEqual([]);
  await context.close();
});
