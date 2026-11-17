// Computed-style snapshot of the dev-only style guide (decision D83, plan I100 step 1). It proves
// that moving `public/app.css` into cascade layers changes no computed style. Skipped unless the
// environment variable CSS_SNAPSHOT is `write` or `compare`, so plain `npm run e2e` is unaffected
// (this spec then shows up as skipped tests).
//
// Usage (needs Docker like the rest of the e2e run; snapshots are never committed):
//   npm run css:snapshot:write                  stores the snapshot of the current CSS
//   npm run css:snapshot:compare                compares the current CSS with the stored one
//   CSS_SNAPSHOT_DIR=.css-snapshots/other ...   another folder (default .css-snapshots/current;
//                                               the root folder .css-snapshots/ is git-ignored)
// Extra Playwright arguments go after `--`, for example `-- --workers=5`.
//
// Files, per project (a name is `<project>-<scheme>-<width>[-<kind>].json`):
//   -320, -390          resting state, light and dark (the original snapshot).
//   -320-forced, -390-forced   the same with `forcedColors: "active"` emulated: Chromium projects
//                       only (Playwright's WebKit has no forced-colors emulation, those tests skip).
//   -390-hover          hover state, 390 px only (hover does not depend on the width).
//   -390-focus          keyboard focus state, 390 px only.
// Resting files: for every element of `header`, `main` and `footer` (plus the elements themselves)
// a fixed list of computed properties, see PROPERTIES below, plus `::before` and `::after` when
// their content is not none. Sizes are the laid out box rounded to 1 px, numbers inside values are
// rounded to 0.01, text and attributes are not stored. Key of an element: `<root> > <path>`, where
// root is `#<id>` of the nearest `section[id]` or else `header`, `main`, `footer`, and path is
// `tag.class.class:<index among the parent's element children>` joined with ` > ` from the root
// (the root itself is `<root> > .`).
// State files: the compact property set (colours, border colours and widths, outline, box-shadow,
// text-decoration-line, opacity, cursor, transform, and the same for pseudo-elements with content)
// and ONLY the values that differ from the resting value; an element without a change keeps an
// empty entry, so a lost rule shows up as the property going back to `(absent)`. Hover: the mouse
// moves (real `page.mouse.move`, element scrolled to the middle first) to the centre of every a,
// button, summary, label, select, input, textarea and [tabindex]/[role] element in turn; entries
// are the key of the element plus ` desc <relative path>` for descendants, ` +parent`, and
// ` +control` for a label's input. Focus: a bounded Tab walk (Alt+Tab in WebKit: press cap,
// per-press deadline, wall-clock budget, trace off); entries are the focused element, its
// descendants, ` +parent`, ` +wrapper` (`.inline-input`, label or `.field`) and its descendants
// (for a label or `.inline-input`), and ` +label`. Radios are reached by Tab only for one per
// group, the others are not walked. Not covered by the style guide's markup: see the report of the
// run that added this (no [readonly], aria-expanded/current/selected, explicit data-theme, map).
// `compare` fails with a report of added, removed and changed elements and properties (the first
// 100 differences per file, then the totals).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { person } from "./helpers.ts";

const MODE = process.env.CSS_SNAPSHOT;
const DIR = resolve(
  join(import.meta.dirname, ".."),
  process.env.CSS_SNAPSHOT_DIR ?? ".css-snapshots/current",
);
const WIDTHS = [320, 390] as const;
const SCHEMES = ["light", "dark"] as const;
const MAX_REPORTED = 100;

type Snapshot = Record<string, Record<string, string>>;

/** Browser-side helpers shared by every collector (strings: no DOM types in this project). */
const PRELUDE = `
  const SIDES = ["top", "right", "bottom", "left"];
  const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
  const SIMPLE = [
    "display", "position", "top", "right", "bottom", "left", "color", "background-color",
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
    "text-decoration-line", "text-transform", "text-align", "white-space", "overflow-x",
    "overflow-y", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
    "align-items", "justify-content", "row-gap", "column-gap", "grid-template-columns",
    "opacity", "visibility", "box-shadow", "cursor", "z-index", "transform",
  ];
  const PSEUDO_SIMPLE = ["display", "background-color", "transform"];
  const round = (value) =>
    value.replace(/-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?/g, (n) => String(Math.round(parseFloat(n) * 100) / 100));
  const kind = (value) => {
    if (value === "none") return "none";
    const m = value.match(/^[a-z-]+(?=\\()/);
    return m === null ? "other" : m[0];
  };
  const box = (s, prefix, suffix) => SIDES.map((side) => s.getPropertyValue(prefix + "-" + side + suffix)).join(" ");
  const common = (s, out, p) => {
    out[p + "margin"] = round(box(s, "margin", ""));
    out[p + "padding"] = round(box(s, "padding", ""));
    for (const side of SIDES) {
      out[p + "border-" + side] = round(
        s.getPropertyValue("border-" + side + "-width") + " " + s.getPropertyValue("border-" + side + "-style") + " " + s.getPropertyValue("border-" + side + "-color"),
      );
    }
    out[p + "border-radius"] = round(CORNERS.map((c) => s.getPropertyValue("border-" + c + "-radius")).join(" "));
    out[p + "background-image"] = kind(s.getPropertyValue("background-image"));
  };
  const values = (el, pseudo) => {
    const s = getComputedStyle(el, pseudo);
    const out = {};
    if (pseudo === null) {
      for (const name of SIMPLE) out[name] = round(s.getPropertyValue(name));
      common(s, out, "");
      out.outline = round([s.outlineWidth, s.outlineStyle, s.outlineColor, s.outlineOffset].join(" "));
      const r = el.getBoundingClientRect();
      out.width = String(Math.round(r.width));
      out.height = String(Math.round(r.height));
      return out;
    }
    const content = s.getPropertyValue("content");
    if (content === "none" || content === "normal") return null;
    out.content = content;
    for (const name of PSEUDO_SIMPLE) out[name] = round(s.getPropertyValue(name));
    common(s, out, "");
    out.width = round(s.getPropertyValue("width"));
    out.height = round(s.getPropertyValue("height"));
    return out;
  };
  const segment = (el) => {
    const cls = typeof el.className === "string" && el.className.trim() !== "" ? "." + el.className.trim().split(/\\s+/).join(".") : "";
    const index = el.parentElement === null ? 0 : [...el.parentElement.children].indexOf(el);
    return el.tagName.toLowerCase() + cls + ":" + index;
  };
`;

/** Key of an element (see the header comment), or null outside header, main and footer. */
const KEY_OF = `
  const keyOf = (el) => {
    if (["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName)) return null;
    let landmark = el;
    while (landmark !== null && !(landmark.parentElement === document.body && ["HEADER", "MAIN", "FOOTER"].includes(landmark.tagName))) landmark = landmark.parentElement;
    if (landmark === null) return null;
    const section = el.closest("section[id]");
    const root = section !== null && landmark.contains(section) ? section : landmark;
    const label = root === landmark ? landmark.tagName.toLowerCase() : "#" + root.id;
    const path = [];
    for (let e = el; e !== root; e = e.parentElement) path.unshift(segment(e));
    return label + " > " + (path.length === 0 ? "." : path.join(" > "));
  };
`;

/** Browser-side collector of the resting state. Returns the snapshot. */
const COLLECT = `(() => {${PRELUDE}${KEY_OF}
  const snapshot = {};
  for (const el of document.querySelectorAll("header, main, footer, header *, main *, footer *")) {
    const key = keyOf(el);
    if (key === null) continue;
    const entry = values(el, null);
    for (const pseudo of ["::before", "::after"]) {
      const p = values(el, pseudo);
      if (p !== null) for (const [name, value] of Object.entries(p)) entry[pseudo + " " + name] = value;
    }
    snapshot[key] = entry;
  }
  return snapshot;
})()`;

/**
 * Browser-side state collector, installed as `window.__sg`. `compact(el)` is the small property set
 * (colours, border widths, outline, shadow, decoration, opacity, cursor, transform, and the same for
 * ::before/::after with content). The resting values of every element are read once at install time,
 * before any hover or focus; an entry of a state snapshot holds only the properties that differ from
 * resting (an element without a change keeps an empty entry, so a lost rule is reported as the
 * property going back to "(absent)").
 */
const STATE = `(() => {${PRELUDE}${KEY_OF}
  const PROPS = [
    "color", "background-color", "border-top-color", "border-right-color", "border-bottom-color",
    "border-left-color", "border-top-width", "border-right-width", "border-bottom-width",
    "border-left-width", "box-shadow", "text-decoration-line", "opacity", "cursor", "transform",
  ];
  const compact = (el) => {
    const out = {};
    const s = getComputedStyle(el);
    for (const n of PROPS) out[n] = round(s.getPropertyValue(n));
    out.outline = round([s.outlineWidth, s.outlineStyle, s.outlineColor, s.outlineOffset].join(" "));
    for (const pseudo of ["::before", "::after"]) {
      const p = getComputedStyle(el, pseudo);
      const content = p.getPropertyValue("content");
      if (content === "none" || content === "normal") continue;
      for (const n of PROPS) out[pseudo + " " + n] = round(p.getPropertyValue(n));
    }
    return out;
  };
  const resting = new Map();
  for (const el of document.querySelectorAll("header, main, footer, header *, main *, footer *")) resting.set(el, compact(el));
  const rel = (root, el) => {
    const path = [];
    for (let e = el; e !== root; e = e.parentElement) path.unshift(segment(e));
    return path.join(" > ");
  };
  const diffOf = (el) => {
    const base = resting.get(el) || {};
    const out = {};
    for (const [k, v] of Object.entries(compact(el))) if (base[k] !== v) out[k] = v;
    return out;
  };
  const descendants = (el) => [...el.querySelectorAll("*")].filter((d) => !["SCRIPT", "STYLE", "TEMPLATE"].includes(d.tagName));
  /** [suffix, element] pairs that a state of el may restyle. */
  const related = (el, kind) => {
    const list = [["", el]];
    for (const d of descendants(el)) list.push([" desc " + rel(el, d), d]);
    if (el.parentElement !== null) list.push([" +parent", el.parentElement]);
    if (kind === "hover") {
      if (el.tagName === "LABEL" && el.control) list.push([" +control", el.control]);
    } else {
      const wrapper = el.closest(".inline-input, label, .field");
      if (wrapper !== null && wrapper !== el && wrapper !== el.parentElement) list.push([" +wrapper", wrapper]);
      if (wrapper !== null && wrapper !== el && (wrapper.tagName === "LABEL" || wrapper.matches(".inline-input"))) {
        for (const d of descendants(wrapper)) if (d !== el && !el.contains(d)) list.push([" +wrapper desc " + rel(wrapper, d), d]);
      }
      const label = el.labels && el.labels[0];
      if (label && label !== wrapper) list.push([" +label", label]);
    }
    return list;
  };
  const record = (el, kind) => {
    const key = keyOf(el);
    const out = {};
    for (const [suffix, other] of related(el, kind)) {
      if (!resting.has(other)) continue;
      out[key + suffix] = diffOf(other);
    }
    return out;
  };
  const TARGETS = "a, button, summary, label, select, input:not([type=hidden]), textarea, [role=button], [role=menuitem], [tabindex]";
  const targets = [...new Set(document.querySelectorAll(TARGETS))].filter((el) => {
    if (keyOf(el) === null) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4 && getComputedStyle(el).visibility === "visible";
  });
  let seen = new Set();
  let first = null;
  let last = null;
  window.__sg = {
    count: () => targets.length,
    /** Scroll target i to the middle and return the point to hover. */
    prep: (i) => {
      const el = targets[i];
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1), y: Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1) };
    },
    hover: (i) => record(targets[i], "hover"),
    focusable: () => document.querySelectorAll("a[href], button, summary, input:not([type=hidden]), select, textarea, [tabindex]").length,
    /** After a key press: record the focused element (once) and report the walk state. */
    stop: () => {
      const el = document.activeElement;
      const before = last;
      let entries = {};
      if (el !== null && el !== document.body && el !== last) {
        last = el;
        if (first === null) first = el;
        if (keyOf(el) !== null && !seen.has(el)) {
          seen.add(el);
          entries = record(el, "focus");
        }
      }
      const wrapped = before !== null && last === first && before !== first;
      return { entries, seen: seen.size, wrapped, now: el !== null && el !== document.body && keyOf(el) !== null ? keyOf(el) : "none" };
    },
  };
  return targets.length;
})()`;

/** Stored form: one line per element, so a text diff of two runs is readable. */
function serialise(snapshot: Snapshot): string {
  const lines = Object.keys(snapshot)
    .toSorted()
    .map((key) => {
      const entry = snapshot[key] ?? {};
      const sorted = Object.fromEntries(
        Object.keys(entry)
          .toSorted()
          .map((k) => [k, entry[k]]),
      );
      return `${JSON.stringify(key)}:${JSON.stringify(sorted)}`;
    });
  return `{\n${lines.join(",\n")}\n}\n`;
}

/** The differences as readable lines, in a stable order. */
function differences(stored: Snapshot, current: Snapshot): string[] {
  const out: string[] = [];
  for (const key of Object.keys(stored).toSorted()) {
    const before = stored[key];
    const after = current[key];
    if (before === undefined) continue;
    if (after === undefined) {
      out.push(`removed element ${key}`);
      continue;
    }
    for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].toSorted()) {
      if (before[name] !== after[name]) {
        out.push(
          `changed ${key} [${name}]: ${before[name] ?? "(absent)"} -> ${after[name] ?? "(absent)"}`,
        );
      }
    }
  }
  for (const key of Object.keys(current).toSorted()) {
    if (stored[key] === undefined) out.push(`added element ${key}`);
  }
  return out;
}

// No trace: the page has thousands of nodes and nothing here needs one.
test.use({ trace: "off" });
// Each test writes its own file, so they may run in parallel workers (`-- --workers=5`).
test.describe.configure({ mode: "parallel" });

/** Writes the snapshot (write mode) or compares it with the stored file and reports differences. */
function finish(name: string, current: Snapshot): void {
  const file = join(DIR, name);
  if (MODE === "write") {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serialise(current));
    return;
  }
  let stored: Snapshot;
  try {
    stored = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  } catch {
    throw new Error(`no stored snapshot ${file}; run CSS_SNAPSHOT=write first`);
  }
  const all = differences(stored, current);
  const count = (prefix: string) => all.filter((line) => line.startsWith(prefix)).length;
  const report =
    all.length === 0
      ? ""
      : `${name}: ${all.length} differences (${count("changed")} changed properties, ${count("added")} added and ${count("removed")} removed elements)\n` +
        all.slice(0, MAX_REPORTED).join("\n") +
        (all.length > MAX_REPORTED ? `\n... ${all.length - MAX_REPORTED} more` : "");
  expect(report, "computed style differences").toBe("");
}

const fileName = (project: string, scheme: string, width: number, kind: string) =>
  `${project.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${scheme}-${width}${kind === "" ? "" : `-${kind}`}.json`;

/** A fresh page on the style guide: details open, fonts loaded, nothing running. */
async function openStyleGuide(
  browser: Browser,
  baseURL: string,
  scheme: (typeof SCHEMES)[number],
  width: number,
  forced: boolean,
) {
  const problems: string[] = [];
  const { context, page } = await person(browser, baseURL, problems, {
    context: { colorScheme: scheme, viewport: { width, height: 800 } },
  });
  if (forced) await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/styleguide");
  await settle(page);
  return { context, page };
}

/** Opens every details, then waits for fonts and finishes any running animation. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(`document.querySelectorAll("details").forEach((d) => { d.open = true; })`);
  await page.evaluate(
    `document.fonts.ready.then(() => document.getAnimations().forEach((a) => a.finish()))`,
  );
}

/** One hover pass: the mouse moves to the centre of every interactive element in turn. */
async function hoverPass(
  browser: Browser,
  baseURL: string,
  scheme: (typeof SCHEMES)[number],
): Promise<Snapshot> {
  const { context, page } = await openStyleGuide(browser, baseURL, scheme, 390, false);
  const count = await page.evaluate<number>(STATE);
  expect(count, "hover targets").toBeGreaterThan(50);
  const result: Snapshot = {};
  for (let i = 0; i < count; i += 1) {
    const point = await page.evaluate<{ x: number; y: number }>(`window.__sg.prep(${i})`);
    await page.mouse.move(point.x, point.y);
    Object.assign(result, await page.evaluate<Snapshot>(`window.__sg.hover(${i})`));
  }
  await context.close();
  return result;
}

/** One keyboard pass: a bounded Tab walk (Alt+Tab in WebKit) that records every stop. */
async function focusPass(
  browser: Browser,
  baseURL: string,
  scheme: (typeof SCHEMES)[number],
): Promise<Snapshot> {
  const { context, page } = await openStyleGuide(browser, baseURL, scheme, 390, false);
  await page.evaluate<number>(STATE);
  // macOS WebKit tabs through form fields only; Option+Tab also stops on links, buttons and radios.
  const key = browser.browserType().name() === "webkit" ? "Alt+Tab" : "Tab";
  // Bounded like the walk in styleguide.spec.ts: it ends at a wrap, after 15 presses in a row that
  // reach no new element, or at the press cap; each press has a deadline and the walk a budget.
  const maxPresses = (await page.evaluate<number>(`window.__sg.focusable()`)) * 2 + 30;
  const PRESS_DEADLINE_MS = 20_000;
  const WALK_BUDGET_MS = 150_000;
  const started = Date.now();
  const result: Snapshot = {};
  let stale = 0;
  let seen = 0;
  let last = "none";
  let pressed = 0;
  for (; pressed < maxPresses && stale < 15; pressed += 1) {
    if (Date.now() - started > WALK_BUDGET_MS) {
      throw new Error(
        `Tab walk over its ${WALK_BUDGET_MS} ms budget after ${pressed} presses; last focused ${last}`,
      );
    }
    const state = await Promise.race([
      page.keyboard
        .press(key)
        .then(() =>
          page.evaluate<{ entries: Snapshot; seen: number; wrapped: boolean; now: string }>(
            `window.__sg.stop()`,
          ),
        ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Tab walk stuck: press ${pressed} took over ${PRESS_DEADLINE_MS} ms; last focused ${last}`,
              ),
            ),
          PRESS_DEADLINE_MS,
        ).unref(),
      ),
    ]);
    Object.assign(result, state.entries);
    last = state.now;
    stale = state.seen === seen ? stale + 1 : 0;
    seen = state.seen;
    if (state.wrapped) break;
  }
  expect(pressed, `Tab walk hit its press cap (${maxPresses}); last focused ${last}`).toBeLessThan(
    maxPresses,
  );
  expect(seen, "focus stops walked").toBeGreaterThan(50);
  await context.close();
  return result;
}

test.describe("computed style snapshot of the style guide", () => {
  test.skip(MODE !== "write" && MODE !== "compare", "set CSS_SNAPSHOT=write or compare to run");

  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      test(`${MODE ?? "skipped"} snapshot, ${scheme}, ${width} px`, async ({
        browser,
        baseURL,
      }, testInfo) => {
        const { context, page } = await openStyleGuide(
          browser,
          baseURL ?? "",
          scheme,
          width,
          false,
        );
        const collect = async () => {
          await settle(page);
          return page.evaluate<Snapshot>(COLLECT);
        };
        const current = await collect();
        // Determinism guard: a reload gives the same snapshot.
        await page.reload();
        const reloaded = await collect();
        expect(differences(current, reloaded), "differences after a reload").toEqual([]);
        await context.close();
        expect(Object.keys(current).length, "elements collected").toBeGreaterThan(500);
        finish(fileName(testInfo.project.name, scheme, width, ""), current);
      });

      // Forced colors (Windows high contrast): the `@media (forced-colors: active)` blocks.
      test(`${MODE ?? "skipped"} snapshot, forced colors, ${scheme}, ${width} px`, async ({
        browser,
        baseURL,
      }, testInfo) => {
        // WebKit has no forced-colors emulation in Playwright; Chromium and Firefox only.
        test.skip(browser.browserType().name() === "webkit", "WebKit cannot emulate forced colors");
        const { context, page } = await openStyleGuide(browser, baseURL ?? "", scheme, width, true);
        expect(
          await page.evaluate(`matchMedia("(forced-colors: active)").matches`),
          "forced colors active",
        ).toBe(true);
        const current = await page.evaluate<Snapshot>(COLLECT);
        await page.reload();
        await settle(page);
        const reloaded = await page.evaluate<Snapshot>(COLLECT);
        expect(differences(current, reloaded), "differences after a reload").toEqual([]);
        await context.close();
        expect(Object.keys(current).length, "elements collected").toBeGreaterThan(500);
        finish(fileName(testInfo.project.name, scheme, width, "forced"), current);
      });
    }

    // Hover and keyboard focus: one width is enough, the states do not depend on it.
    test(`${MODE ?? "skipped"} snapshot, hover states, ${scheme}, 390 px`, async ({
      browser,
      baseURL,
    }, testInfo) => {
      const current = await hoverPass(browser, baseURL ?? "", scheme);
      // Determinism guard: a second pass in a fresh context gives the same snapshot.
      expect(differences(current, await hoverPass(browser, baseURL ?? "", scheme))).toEqual([]);
      expect(Object.keys(current).length, "entries collected").toBeGreaterThan(100);
      finish(fileName(testInfo.project.name, scheme, 390, "hover"), current);
    });

    test(`${MODE ?? "skipped"} snapshot, focus states, ${scheme}, 390 px`, async ({
      browser,
      baseURL,
    }, testInfo) => {
      // The walk presses a few hundred keys; WebKit's Option+Tab is slow under a parallel run.
      test.slow();
      const current = await focusPass(browser, baseURL ?? "", scheme);
      expect(Object.keys(current).length, "entries collected").toBeGreaterThan(100);
      finish(fileName(testInfo.project.name, scheme, 390, "focus"), current);
    });
  }
});
