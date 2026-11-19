// Guards for the full-screen map (ADR 008): a modal dialog over the whole viewport (100dvh after
// a 100vh fallback, no UA max-width or margin), a grid only while open, the page locked under it,
// the map in it without a frame (bold included), 48 px icons and the expand icon's SVG. The live
// result is e2e/map-full.spec.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { declarations, loadStylesheet } from "../support/css.ts";

const PUBLIC = join(import.meta.dirname, "../../public");
const css = loadStylesheet();
const BOLD = ':root[data-palette="bold"]';
const MONO = ':root[data-palette="mono"]';
const mono = loadStylesheet("palettes/mono.css");

describe("the full-screen map dialog", () => {
  it("covers the viewport: fixed, no UA max size or margin, 100dvh after the 100vh fallback", () => {
    const rule = css.first("dialog.map-dialog", { layer: "components" });
    const list = declarations(rule.body);
    const heights = list.filter((d) => d.property === "height").map((d) => d.value);
    expect(heights).toEqual(["100vh", "100dvh"]);
    const body = css.rule("dialog.map-dialog");
    for (const part of [
      "position: fixed",
      "inset: 0",
      "width: 100%",
      "max-width: none",
      "max-height: none",
      "margin: 0",
      "padding: 0",
      "border: 0",
      "background: var(--bg)",
      "color: var(--fg)",
      "overscroll-behavior: contain",
    ]) {
      expect(body).toContain(part);
    }
    // A closed dialog keeps the browser's display: none.
    expect(body).not.toContain("display");
  });

  it("lays out head, map and foot as a grid only while open", () => {
    const open = css.rule("dialog.map-dialog[open]");
    expect(open).toContain("display: grid");
    expect(open).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(css.rule(".map-dialog-stage")).toContain("min-height: 0");
    expect(css.rule(".map-dialog-stage")).toContain("position: relative");
    expect(css.rule(".map-dialog::backdrop")).toContain("background: var(--bg)");
  });

  it("locks the page's scrolling in the layout layer while one is open", () => {
    const lock = css.first(":root:has(dialog.map-dialog[open])");
    expect(lock.layer).toBe("layout");
    expect(lock.body).toContain("overflow: hidden");
  });

  it("puts its chrome in the components layer, colours from tokens only", () => {
    const chrome = css.all.filter(
      (rule) =>
        /\.map-dialog(?!\s+\.map\b)|\.map-key/.test(rule.selector) &&
        !/data-palette/.test(rule.selector),
    );
    expect(chrome.length).toBeGreaterThan(8);
    for (const rule of chrome.filter((r) => !r.selector.startsWith(":root:has"))) {
      expect([rule.selector, rule.layer]).toEqual([
        rule.selector,
        rule.atRules.some((at) => at.includes("forced-colors")) ? "forced-colors" : "components",
      ]);
    }
    const body = chrome.map((rule) => rule.body).join("\n");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });

  it("keeps the key's swatches in forced colours", () => {
    const forced = css.first(".map-key", { atRule: "forced-colors: active" });
    expect(forced.layer).toBe("forced-colors");
    expect(forced.body).toContain("forced-color-adjust: none");
  });

  it("keeps the locate icon's centre dot in forced colours", () => {
    const dot = css.first(".map-locate-icon::before", { atRule: "forced-colors: active" });
    expect(dot.layer).toBe("forced-colors");
    expect(dot.body).toBe("forced-color-adjust: none;");
    expect(css.first(".map-locate-icon::before").body).toContain("background: currentColor");
  });
});

describe("the form map's and Nearby's dialog parts (ADR 008)", () => {
  it("gives the dialog's own mode switch the page's segmented look", () => {
    const rule = css.first(".plan-form .mode-switch, .map-dialog .mode-switch", {
      layer: "components",
    });
    expect(rule.body).toContain("display: flex");
    expect(rule.body).toContain("border: 0");
  });

  it("lays the foot out as a row: Done a pill first, the status line taking the rest", () => {
    const foot = css.first(".map-dialog-foot", { layer: "components" }).body;
    for (const part of ["display: flex", "flex-wrap: wrap", "border-top: 1px solid var(--line)"]) {
      expect(foot).toContain(part);
    }
    expect(foot).toContain("env(safe-area-inset-bottom)");
    expect(css.rule(".map-dialog-foot button.map-dialog-done")).toContain(
      "border-radius: var(--r-pill)",
    );
    const status = css.rule(".map-dialog-status");
    // 5rem: Done, the status line and Remove point share one row on a 390 px phone.
    expect(status).toContain("flex: 1 1 5rem");
    expect(status).toContain("min-width: 0");
  });

  it("draws Remove point as a quiet, underlined danger text button with a 44 px target", () => {
    const remove = css.rule(".map-dialog-foot button.map-dialog-remove");
    for (const part of [
      "min-height: var(--target)",
      "background: transparent",
      "color: var(--danger)",
      "text-decoration: underline",
    ]) {
      expect(remove).toContain(part);
    }
  });
});

describe("the map inside the dialog", () => {
  it("fills the stage edge to edge and resets the page map's frame, unlayered like .map", () => {
    const rule = css.first(".map-dialog .map");
    expect(rule.layer).toBeUndefined();
    for (const part of [
      "position: absolute",
      "inset: 0",
      "height: auto",
      "margin: 0",
      "border: 0",
      "border-radius: 0",
    ]) {
      expect(css.rule(".map-dialog .map")).toContain(part);
    }
  });

  it("draws the keyboard focus ring inside the map's edge, above Leaflet's panes", () => {
    const ring = css.first(".map-dialog .map:focus-visible");
    expect(ring.layer).toBeUndefined();
    expect(ring.body).toBe("outline-offset: -3px;");
    // Leaflet's panes paint over an outline inside the map: a frame above them, taps go through.
    const frame = css.first(".map-dialog .map:focus-visible::after");
    expect(frame.layer).toBeUndefined();
    for (const part of [
      "position: absolute",
      "inset: 0",
      "z-index: 1000",
      "border: 3px solid var(--focus)",
      "pointer-events: none",
    ]) {
      expect(frame.body).toContain(part);
    }
    // Pointer focus shows no ring: only :focus-visible draws one (base layer).
    expect(css.all.some((rule) => /\.map-dialog \.map:focus(?!-visible)/.test(rule.selector))).toBe(
      false,
    );
  });

  it("takes bold's square frame off too: its .map frame rule outranks the plain reset", () => {
    expect(css.rule(`${BOLD} .map`)).toContain("border: 2px solid var(--line)");
    const reset = css.first(`${BOLD} .map-dialog .map`);
    expect(reset.layer).toBeUndefined();
    expect(reset.body).toBe("border: 0;");
    expect(css.isLater(reset, css.first(`${BOLD} .map`))).toBe(true);
  });

  it("makes the expand and Close icons and the dialog's zoom buttons 48 px", () => {
    const icons = css.rule(
      ".map .leaflet-bar button.map-expand, .map .leaflet-bar button.map-close",
    );
    for (const part of ["width: 48px", "height: 48px", "min-height: 48px"]) {
      expect(icons).toContain(part);
    }
    expect(icons).toContain("background: var(--surface)");
    expect(icons).toContain("color: var(--fg)");
    // Leaflet's .leaflet-touch .leaflet-bar a (0,2,1) loads after app.css: this one is more specific.
    const zoom = css.rule(".map-dialog .map.leaflet-container .leaflet-bar a");
    expect(zoom).toContain("width: 48px");
    expect(zoom).toContain("height: 48px");
    // The locate button under them as well (the page maps keep their 44 px one).
    const locate = css.first(".map-dialog .map .leaflet-bar button.map-locate");
    expect(locate.layer).toBeUndefined();
    for (const part of ["width: 48px", "height: 48px", "min-height: 48px"]) {
      expect(locate.body).toContain(part);
    }
    expect(css.isLater(locate, css.first(".map .leaflet-bar button.map-locate"))).toBe(true);
  });

  it("sets the key in the page's typeface, not the Helvetica of Leaflet's container", () => {
    expect(css.rule(".map-dialog-legend", { layer: "components" })).toContain(
      "font-family: var(--font-body)",
    );
    expect(css.rule("body", { layer: "base" })).toContain("var(--font-body)");
  });
});

describe("the expand icon", () => {
  it("points at an SVG that exists, drawn with a 2 px stroke like the close icon", () => {
    expect(css.rule(".icon-expand", { layer: "components" })).toContain(
      '--icon: url("icons/expand.svg")',
    );
    const file = join(PUBLIC, "icons/expand.svg");
    expect(existsSync(file)).toBe(true);
    const svg = readFileSync(file, "utf8");
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).not.toMatch(/<script|on\w+=/i);
  });
});

describe("Nearby's Use my location once refused (ADR 008 polish)", () => {
  it("looks inactive while aria-disabled, on the page and in the dialog, in the components layer", () => {
    const rule = css.first(
      '.map-tools button.secondary[aria-disabled="true"], .map-dialog-foot button.secondary[aria-disabled="true"]',
    );
    expect(rule.layer).toBe("components");
    expect(rule.body).toContain("cursor: not-allowed");
    expect(rule.body).toContain("color: var(--muted)");
  });
});

describe("the full-screen map in the palettes", () => {
  const dialogRules = (sheet: typeof css, scope: string) =>
    sheet.all.filter(
      (rule) =>
        rule.selector.startsWith(scope) && /map-dialog|map-key|map-expand/.test(rule.selector),
    );

  it("has bold rules for the head, the foot, Done, the key and the controls", () => {
    const selectors = dialogRules(css, BOLD).map((rule) => rule.selector);
    for (const part of [
      ".map-dialog-plan .map-dialog-head",
      ".map-dialog-head",
      ".map-dialog-foot",
      ".map-dialog-foot button.map-dialog-done",
      ".map-dialog-legend",
      ".map-dialog .map .leaflet-bar",
    ]) {
      expect(selectors.some((selector) => selector.includes(`${BOLD} ${part}`))).toBe(true);
    }
  });

  it("puts bold's chrome in pages, and only its .map and Leaflet rules unlayered", () => {
    for (const rule of dialogRules(css, BOLD)) {
      const leaflet = /\.map(?![\w-])|leaflet/.test(rule.selector);
      expect([rule.selector, rule.layer]).toEqual([rule.selector, leaflet ? undefined : "pages"]);
    }
  });

  it("puts mono's rules in pages, none touching outlines, sizes, focus or inputs", () => {
    const rules = dialogRules(mono, MONO);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect([rule.selector, rule.layer]).toEqual([rule.selector, "pages"]);
      expect(rule.selector).not.toMatch(/:focus|input|select|textarea/);
      expect(rule.body).not.toMatch(/outline|min-height|min-width|!important/);
    }
  });

  it("leaves Done a pill in the default and in mono (whose --r-button is the pill)", () => {
    expect(css.rule(".map-dialog-foot button.map-dialog-done")).toBe(
      "border-radius: var(--r-pill);",
    );
    expect(mono.all.some((rule) => /map-dialog-done/.test(rule.selector))).toBe(false);
  });
});
