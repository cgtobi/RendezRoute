// Computed-style snapshot of the dev-only style guide (decision D83, plan I100 step 1). It proves
// that moving `public/app.css` into cascade layers changes no computed style. Skipped unless the
// environment variable CSS_SNAPSHOT is `write` or `compare`, so plain `npm run e2e` is unaffected
// (this spec then shows up as skipped tests, one per project, scheme and width).
//
// Usage (needs Docker like the rest of the e2e run; snapshots are never committed):
//   npm run css:snapshot:write                  stores the snapshot of the current CSS
//   npm run css:snapshot:compare                compares the current CSS with the stored one
//   CSS_SNAPSHOT_DIR=.css-snapshots/other ...   another folder (default .css-snapshots/current;
//                                               the root folder .css-snapshots/ is git-ignored)
// Extra Playwright arguments go after `--`, for example `-- --workers=5`.
//
// One JSON file per project, colour scheme and width. For every element of `header`, `main` and
// `footer` (plus the elements themselves) it stores a fixed list of computed properties, see
// PROPERTIES below, plus `::before` and `::after` when their content is not none. Sizes are the
// laid out box rounded to 1 px, numbers inside values are rounded to 0.01, text and attributes are
// not stored. No hover or focus state is emulated. Key of an element: `<root> > <path>`, where
// root is `#<id>` of the nearest `section[id]` or else `header`, `main`, `footer`, and path is
// `tag.class.class:<index among the parent's element children>` joined with ` > ` from the root
// (the root itself is `<root> > .`). `compare` fails with a report of added, removed and changed
// elements and properties (the first 100 differences, then the totals).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
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

/** Browser-side collector (a string: no DOM types in this project). Returns the snapshot. */
const COLLECT = `(() => {
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
  const snapshot = {};
  const roots = [...document.querySelectorAll("header, main, footer")].filter((e) => e.parentElement === document.body);
  for (const landmark of roots) {
    for (const el of [landmark, ...landmark.querySelectorAll("*")]) {
      if (["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName)) continue;
      const section = el.closest("section[id]");
      const root = section !== null && landmark.contains(section) ? section : landmark;
      const label = root === landmark ? landmark.tagName.toLowerCase() : "#" + root.id;
      const path = [];
      for (let e = el; e !== root; e = e.parentElement) path.unshift(segment(e));
      const key = label + " > " + (path.length === 0 ? "." : path.join(" > "));
      const entry = values(el, null);
      for (const pseudo of ["::before", "::after"]) {
        const p = values(el, pseudo);
        if (p !== null) for (const [name, value] of Object.entries(p)) entry[pseudo + " " + name] = value;
      }
      snapshot[key] = entry;
    }
  }
  return snapshot;
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

test.describe("computed style snapshot of the style guide", () => {
  test.skip(MODE !== "write" && MODE !== "compare", "set CSS_SNAPSHOT=write or compare to run");

  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      test(`${MODE ?? "skipped"} snapshot, ${scheme}, ${width} px`, async ({
        browser,
        baseURL,
      }, testInfo) => {
        const problems: string[] = [];
        const { context, page } = await person(browser, baseURL ?? "", problems, {
          context: { colorScheme: scheme, viewport: { width, height: 800 } },
        });
        await page.goto("/styleguide");
        const collect = async () => {
          await page.evaluate(
            `document.querySelectorAll("details").forEach((d) => { d.open = true; })`,
          );
          // Settle fonts and finish any running transition before reading styles.
          await page.evaluate(
            `document.fonts.ready.then(() => document.getAnimations().forEach((a) => a.finish()))`,
          );
          return page.evaluate<Snapshot>(COLLECT);
        };
        const current = await collect();
        // Determinism guard: a reload gives the same snapshot.
        await page.reload();
        const reloaded = await collect();
        expect(differences(current, reloaded), "differences after a reload").toEqual([]);
        await context.close();
        expect(Object.keys(current).length, "elements collected").toBeGreaterThan(500);

        const name = `${testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${scheme}-${width}.json`;
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
      });
    }
  }
});
