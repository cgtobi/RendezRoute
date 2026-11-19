// Guard for the CSS snapshot harness (decision D83, plan I100 step 3a2): every state-dependent
// selector of `public/app.css` must match at least one element of the dev-only style guide at load,
// so `css-snapshot.spec.ts` can see a rule that is lost or flips when the CSS moves into layers.
// A selector that matches nothing fails here unless it is on the allowlist below, with its reason.
//
// How: the browser reads the rules of app.css from `document.styleSheets` (nested @media, @supports
// and @layer included), splits every selector list, drops pseudo-elements and turns the dynamic
// pseudo-classes (hover, focus, ...) into "always true" and, in a second try, "always false" (so
// `:not(:focus)` is covered as well), then asks `querySelector`. Only selectors with a state
// (attribute selector, a state pseudo-class or an `.is-*` / `.field-invalid` class) are checked.
import { expect, test } from "@playwright/test";

/** Selectors that intentionally match nothing on the style guide at load, with the reason. */
const UNCOVERED: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /leaflet|\.map\b|map-locate|map-pick|map-tools|\.map-|\.route-|\.point-pin/,
    reason: "map rules: the style guide has no live Leaflet map (map-pick.spec.ts covers them)",
  },
  {
    pattern: /data-theme/,
    reason:
      "set on <html> by the theme preference: css-snapshot.spec.ts sets it in its theme variants",
  },
  {
    pattern: /data-palette/,
    reason:
      "set on <html> by the palette setting: the style guide renders in the default palette, and test/design/tokens.test.ts checks the bold rules",
  },
  {
    pattern: /popover-open|\.site-header-menu|#site-menu/,
    reason:
      "open header menu popover: opened by the burger, the style guide shows the sheet body only",
  },
  {
    pattern: /dev-banner|\.dev-notice/,
    reason: "dev-only banner: not rendered on the style guide",
  },
];

/**
 * States that must have an element, whatever app.css says: a selector like `:not([readonly])` is
 * covered by any ordinary field, so the positive state needs its own check.
 */
const MUST_MATCH = [
  "input[readonly]",
  "textarea[readonly]",
  "input[readonly]:placeholder-shown",
  "textarea[readonly]:placeholder-shown",
  "input[readonly]:required",
  "textarea[readonly]:required",
  "input:disabled",
  "input:required:placeholder-shown:not(:disabled, [readonly])",
  ".field-invalid input[aria-invalid]",
  ".field-invalid .required-hint",
  ".inline-input.line-action:has(input:required:placeholder-shown) ~ .required-hint",
  ".inline-input.line-action:has(input:not(:placeholder-shown))",
  ".field-invalid .inline-input.line-action:has(input:placeholder-shown)",
  ".field-invalid .inline-input.line-action:has(input:not(:placeholder-shown))",
  ".inline-input.line-action .line-action-button:not([hidden])",
  ".inline-input.line-action .line-action-button[hidden]",
  ".hint[data-label-suggested]:empty",
  ".hint[data-label-suggested]:not(:empty)",
  ".hint[data-description-suggested]:empty",
  ".hint[data-description-suggested]:not(:empty)",
  ".item-actions details[open]",
  ".plan .share .hint:empty",
  "details[open].fold-hide-open",
  ".mode-switch label:has(input:checked)",
  ".choice:has(input:disabled)",
  "input[type=radio]:checked",
  "input[type=checkbox]:checked",
];

/** Browser-side check; returns the selectors that matched nothing, and counts. */
const CHECK = `(() => {
  const DYNAMIC = /:(hover|focus-visible|focus-within|focus|active|visited|link|any-link|target|popover-open|-webkit-autofill|autofill|user-invalid|user-valid|fullscreen|modal|open)(?![\\w-])/g;
  const STATE = /\\[[^\\]]+\\]|:(checked|disabled|enabled|invalid|valid|required|optional|placeholder-shown|read-only|read-write|empty|indeterminate|has|focus-within|target|open|popover-open|hover|focus|focus-visible|active)(?![\\w-])|\\.is-[\\w-]+|\\.field-invalid/;
  const split = (text) => {
    const parts = [];
    let depth = 0, from = 0;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (c === "(" || c === "[") depth += 1;
      else if (c === ")" || c === "]") depth -= 1;
      else if (c === "," && depth === 0) { parts.push(text.slice(from, i)); from = i + 1; }
    }
    parts.push(text.slice(from));
    return parts.map((p) => p.trim()).filter((p) => p !== "");
  };
  const rules = [];
  const walk = (list) => {
    for (const rule of list) {
      if (rule.selectorText !== undefined) rules.push(rule.selectorText);
      if (rule.cssRules !== undefined && rule.cssRules.length > 0) walk(rule.cssRules);
    }
  };
  let sheets = 0;
  for (const sheet of document.styleSheets) {
    if (sheet.href === null || !/\\/app\\.css(\\?|$)/.test(sheet.href)) continue;
    sheets += 1;
    walk(sheet.cssRules);
  }
  const selectors = new Set();
  for (const text of rules) for (const s of split(text)) selectors.add(s);
  const missing = [];
  let checked = 0;
  let unsupported = 0;
  for (const selector of selectors) {
    if (!STATE.test(selector)) continue;
    const base = selector.replace(/::[\\w-]+(\\([^)]*\\))?/g, "");
    checked += 1;
    let hit = false;
    let failed = false;
    for (const replacement of [":is(*)", ":not(*)"]) {
      try {
        if (document.querySelector(base.replace(DYNAMIC, replacement)) !== null) { hit = true; break; }
      } catch {
        failed = true;
      }
    }
    if (hit) continue;
    if (failed) unsupported += 1;
    missing.push(selector);
  }
  return { sheets, total: selectors.size, checked, unsupported, missing };
})()`;

test("every state selector of app.css matches an element of the style guide", async ({ page }) => {
  await page.goto("/styleguide");
  await page.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
  const result = await page.evaluate<{
    sheets: number;
    total: number;
    checked: number;
    unsupported: number;
    missing: string[];
  }>(CHECK);
  expect(result.sheets, "app.css stylesheets found").toBe(1);
  expect(result.checked, "state selectors checked").toBeGreaterThan(60);
  // CSS_COVERAGE_ALL=1 ignores the allowlist, to list everything that is not covered.
  const unexpected = result.missing.filter(
    (selector) =>
      process.env.CSS_COVERAGE_ALL === "1" ||
      !UNCOVERED.some((allowed) => allowed.pattern.test(selector)),
  );
  expect(unexpected, "state selectors that match no element on /styleguide").toEqual([]);
  const absent = await page.evaluate<string[]>(
    `${JSON.stringify(MUST_MATCH)}.filter((selector) => document.querySelector(selector) === null)`,
  );
  expect(absent, "required states with no element on /styleguide").toEqual([]);
});
