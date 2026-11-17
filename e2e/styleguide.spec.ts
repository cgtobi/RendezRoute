// Real-layout checks on the dev-only style guide (decision D72, plan I98 step 13c1). The page
// renders every real view, so one visit covers all of them, with every fold opened. No plan is
// created. Runs at 320 and 390 px, light and dark, in Chromium (both default projects) and in
// the WebKit iPhone project. Everything is measured on the live layout; no pixel baselines.
//
// Checks: (a) nothing scrolls sideways, per section and for the page; (b) no two controls that sit
// side by side (children of one container) overlap; (c) every interactive element is at least
// 44 px in one dimension, bar a documented exception list; (d) Tab shows a visible focus cue on
// every stop of every section; (e) no console error and no CSP violation.
import { expect, test, type Page } from "@playwright/test";
import { person } from "./helpers.ts";

const WIDTHS = [320, 390] as const;
const SCHEMES = ["light", "dark"] as const;

/** Pixels of tolerance for sub-pixel rounding. */
const SLACK = 1;

/** The smallest touch target in one dimension (decision D61). */
const TARGET = 44;

/** The page's sections: `section.sg-section` carries the id (section.where in the form has none). */
const SECTION = "section.sg-section[id]";

/** The inline links in running text that the page has today (see the exception list above). */
const MAX_RUNNING_TEXT_LINKS = 6;

/**
 * Interactive elements that need no 44 px target, each with its reason. A rule matches an element
 * by the browser-side predicate `exempt(el)` below; add nothing here without a reason.
 *  - hidden: inside `.visually-hidden`, or absolutely positioned at 1 px or less. Not a target for
 *    anyone who sees the page, and screen reader users do not tap.
 *  - running text link: an `a` inside a hint, note, notice, warning or readout paragraph, or in the typography sample sentence (the real
 *    prose containers) that has other text around it. WCAG 2.5.8 exempts inline links in a
 *    sentence; the sentence's line height is the target. Listed in the failure message and capped
 *    at MAX_RUNNING_TEXT_LINKS so a new link cannot slip in unseen.
 *  - style guide section index: the dev-only `nav[aria-label=Sections]` list of in-page anchors, a
 *    development aid that is not part of the app.
 */
const BROWSER_HELPERS = `
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return false;
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      if (p.hidden) return false;
      if (p.tagName === "DETAILS" && !p.open) {
        const summary = [...p.children].find((c) => c.tagName === "SUMMARY");
        if (!(summary && summary.contains(el))) return false;
      }
    }
    return true;
  };
  const clipped = (el) => {
    if (el.closest(".visually-hidden") !== null) return true;
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).position === "absolute" && r.width <= 1 && r.height <= 1;
  };
  // The element that shows the focus cue: a visually hidden control (a radio) shows it on its label.
  const cueTarget = (el) => {
    const label = el.closest("label") || (el.id ? document.querySelector('label[for="' + el.id + '"]') : null);
    return clipped(el) && label ? label : el;
  };
  const sign = (target) => {
    const s = getComputedStyle(target);
    const wrap = target.closest(".inline-input");
    const wrapLine = wrap ? getComputedStyle(wrap).borderBottomWidth : "-";
    return {
      outline: s.outlineStyle + " " + s.outlineWidth + " " + s.outlineColor,
      hasOutline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0,
      shadow: s.boxShadow,
      line: s.borderBottomWidth + "/" + wrapLine,
      line2: s.borderBottomWidth === "2px" || wrapLine === "2px",
    };
  };
  const describe = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "";
    const type = el.getAttribute("type");
    return el.tagName.toLowerCase() + id + cls + (type ? "[type=" + type + "]" : "");
  };
`;

/** Browser-side: run a script with the helpers in scope, in the page (a string: no DOM types here). */
function inPage<T>(page: Page, body: string): Promise<T> {
  return page.evaluate<T>(`(() => { ${BROWSER_HELPERS} ${body} })()`);
}

interface Problem {
  where: string;
  detail: string;
}

const format = (list: readonly Problem[]) =>
  list.map((item) => `${item.where}: ${item.detail}`).join("\n");

for (const scheme of SCHEMES) {
  for (const width of WIDTHS) {
    test(`The style guide fits a ${width} px phone in ${scheme} mode, with focus cues, targets and no CSP violation`, async ({
      browser,
      baseURL,
    }) => {
      // The Tab walk presses a few hundred keys; WebKit's Option+Tab is slow under a parallel run.
      test.slow();
      const problems: string[] = [];
      const { context, page } = await person(browser, baseURL ?? "", problems, {
        context: { colorScheme: scheme, viewport: { width, height: 800 } },
      });
      await context.addInitScript(
        `window.__csp = []; document.addEventListener("securitypolicyviolation", (event) => window.__csp.push(event.violatedDirective + " " + event.blockedURI + " on " + (event.target && event.target.tagName ? event.target.tagName.toLowerCase() : String(event.target))));`,
      );
      await page.goto("/styleguide");
      expect(await page.locator(SECTION).count(), "sections on the page").toBeGreaterThanOrEqual(
        13,
      );

      // Open every fold, zone line and details so their contents are measured as well.
      await inPage(
        page,
        `document.querySelectorAll("details").forEach((d) => { d.open = true; });`,
      );

      // (a) Nothing scrolls sideways, per section and for the page.
      const overflow = await inPage<Problem[]>(
        page,
        `const out = [];
         for (const s of document.querySelectorAll(${JSON.stringify(SECTION)})) {
           if (s.scrollWidth > s.clientWidth + ${SLACK}) out.push({ where: "#" + s.id, detail: "scrollWidth " + s.scrollWidth + " > clientWidth " + s.clientWidth });
         }
         const root = document.documentElement;
         if (root.scrollWidth > window.innerWidth + ${SLACK}) out.push({ where: "document", detail: "scrollWidth " + root.scrollWidth + " > innerWidth " + window.innerWidth });
         return out;`,
      );
      expect(format(overflow), "horizontal overflow").toBe("");

      // (b) Controls side by side never overlap: for every container, controls of different
      // children (a flex or grid row, a .field-row, or any block with several children).
      const overlaps = await inPage<{ out: Problem[]; pairs: number }>(
        page,
        `const out = [];
         let pairs = 0;
         const CONTROL = "input:not([type=hidden]), select, textarea, button";
         const controlsOf = (child) => {
           const list = child.matches(CONTROL) ? [child] : [...child.querySelectorAll(CONTROL)];
           return list.filter((c) => visible(c) && !clipped(c));
         };
         for (const parent of document.querySelectorAll("main *, main")) {
           const kids = [...parent.children].filter((c) => visible(c));
           if (kids.length < 2) continue;
           const groups = kids.map(controlsOf);
           for (let i = 0; i < kids.length; i += 1) {
             for (let j = i + 1; j < kids.length; j += 1) {
               for (const a of groups[i]) for (const b of groups[j]) {
                 pairs += 1;
                 const ra = a.getBoundingClientRect();
                 const rb = b.getBoundingClientRect();
                 const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
                 const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
                 if (ox > ${SLACK} && oy > ${SLACK}) out.push({ where: describe(parent), detail: describe(a) + " overlaps " + describe(b) + " by " + ox.toFixed(1) + " x " + oy.toFixed(1) });
               }
             }
           }
         }
         return { out, pairs };`,
      );
      expect(overlaps.pairs, "control pairs compared").toBeGreaterThan(100);
      expect(format(overlaps.out), "overlapping controls").toBe("");

      // (c) Every visible interactive element is a 44 px target in at least one dimension.
      const small = await inPage<{
        out: Problem[];
        checked: number;
        exempted: string[];
        bySection: Record<string, number>;
      }>(
        page,
        `const out = [];
         let checked = 0;
         const exempted = [];
         const bySection = {};
         const TARGETS = "a, button, summary, input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea, label.choice";
         const exempt = (el) => {
           // hidden: visually hidden or inside it.
           if (clipped(el)) return true;
           // running text link: other text in the same paragraph, list item or hint.
           if (el.tagName === "A") {
             const host = el.closest("p.hint, p.note, p.notice, p.warning, .readout-text, #sg-typography p");
             if (host && host.textContent.trim() !== el.textContent.trim()) {
               exempted.push(describe(el) + " in " + describe(host) + ": " + el.textContent.trim());
               return true;
             }
           }
           // style guide section index (dev aid).
           if (el.closest('nav[aria-label="Sections"]')) return true;
           return false;
         };
         for (const el of document.querySelectorAll(TARGETS)) {
           if (!visible(el)) continue;
           // Seen per section, exempt or not, for the "every section is covered" check below.
           const owner = el.closest(${JSON.stringify(SECTION)});
           if (owner) bySection[owner.id] = (bySection[owner.id] || 0) + 1;
           if (exempt(el)) continue;
           checked += 1;
           const r = el.getBoundingClientRect();
           if (Math.max(r.width, r.height) + ${SLACK} < ${TARGET}) out.push({ where: describe(el) + " in " + describe(el.parentElement) + " (" + el.textContent.trim().slice(0, 30) + ")", detail: r.width.toFixed(1) + " x " + r.height.toFixed(1) + " px" });
         }
         return { out, checked, exempted, bySection };`,
      );
      expect(small.checked, "targets measured").toBeGreaterThan(50);
      expect(format(small.out), "targets under 44 px").toBe("");
      expect(
        small.exempted.length,
        `running text links exempted:\n${small.exempted.join("\n")}`,
      ).toBeLessThanOrEqual(MAX_RUNNING_TEXT_LINKS);

      // (d) Keyboard: a Tab walk through each section, with a visible focus cue on every stop. The
      // cue must be new: the styles are read focused, then again after a blur, and must differ.
      // Which cue is required depends on the control: a summary has the inset line (D81), a text
      // line field the outline or the 2 px underline (D78); everything else the global outline.
      // A visually hidden control (a radio) is judged by its visible label.
      const webkit = browser.browserType().name() === "webkit";
      const sections = await inPage<{ id: string; controls: number }[]>(
        page,
        `return [...document.querySelectorAll(${JSON.stringify(SECTION)})].map((s) => ({
           id: s.id,
           controls: [...s.querySelectorAll("a[href], button, summary, input:not([type=hidden]), select, textarea")]
             .filter((c) => !c.disabled && visible(c) && !clipped(c) && !c.closest('nav[aria-label="Sections"]')).length,
         }));`,
      );
      // The styles of every control while nothing has the focus, to compare the stops with.
      await inPage(
        page,
        `document.activeElement.blur();
         window.__before = new Map();
         for (const el of document.querySelectorAll("a[href], button, summary, input:not([type=hidden]), select, textarea")) window.__before.set(el, sign(cueTarget(el)));`,
      );
      // One pass over the whole page, recording each stop inside the page (a focusin listener),
      // so the Node side only presses keys and polls a counter: a round trip per stop was what
      // pushed this test over its time limit under a parallel run.
      await inPage(
        page,
        `window.__stops = [];
         window.__seen = new Set();
         window.__last = null;
         // Called after each key press, from the page: WebKit sends no focusin for date and time
         // fields, so the focus is read from document.activeElement instead of an event.
         window.__record = () => {
           const el = document.activeElement;
           if (el === null || el === document.body || el === window.__last) return;
           window.__last = el;
           window.__seen.add(el);
           const owner = el.closest(${JSON.stringify(SECTION)});
           if (owner === null) return;
           const target = cueTarget(el);
           const after = sign(target);
           const before = window.__before.get(el) || after;
           const type = el.getAttribute("type");
           const textLike = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["date", "time", "file", "color", "radio", "checkbox", "submit", "button"].includes(type || "text"));
           let required;
           if (target.tagName === "SUMMARY") required = /inset/.test(after.shadow);
           else if (textLike) required = after.hasOutline || after.line2;
           else required = after.hasOutline || /inset/.test(after.shadow);
           // WebKit finding: desktop WebKit does not match :focus-visible on the host of a date or
           // time input (focus sits in its inner field), so the global ring is missing there and only
           // the native inner-field highlight shows. Not measurable from outside; skipped in WebKit
           // for those two types only, and reported in the 13c1 notes.
           const exemptKind = ${webkit} && (type === "date" || type === "time");
           const changed = after.outline !== before.outline || after.shadow !== before.shadow || after.line !== before.line;
           window.__stops.push({ id: owner.id, cue: exemptKind || (required && changed), what: describe(el) + (target !== el ? " via " + describe(target) : "") + " before[" + before.outline + " | " + before.shadow + " | " + before.line + "] after[" + after.outline + " | " + after.shadow + " | " + after.line + "]" });
         };
         document.querySelector("h1").setAttribute("tabindex", "-1");
         document.querySelector("h1").focus();`,
      );
      // macOS WebKit tabs through form fields only; Option+Tab also stops on links, buttons
      // and radios, like Tab in Chromium (Safari's own convention).
      const key = webkit ? "Alt+Tab" : "Tab";
      // One evaluate per press records the stop and returns how many elements were seen. The walk
      // ends after 15 presses in a row that reach no new element (the end of the page, where
      // focus wraps; a date or time field takes a few presses), bounded at 1500 presses.
      let stale = 0;
      let seen = 0;
      for (let pressed = 0; pressed < 1500 && stale < 15; pressed += 1) {
        await page.keyboard.press(key);
        const now = await page.evaluate<number>("(window.__record(), window.__seen.size)");
        stale = now === seen ? stale + 1 : 0;
        seen = now;
      }
      const recorded =
        await page.evaluate<{ id: string; cue: boolean; what: string }[]>("window.__stops");
      const missing: Problem[] = recorded
        .filter((stop) => !stop.cue)
        .map((stop) => ({ where: `#${stop.id}`, detail: stop.what }));
      const stopsBySection: Record<string, number> = {};
      for (const stop of recorded) stopsBySection[stop.id] = (stopsBySection[stop.id] ?? 0) + 1;
      const stops = recorded.length;
      expect(stops, "focus stops walked").toBeGreaterThan(50);
      expect(format(missing), "stops without a new visible focus cue").toBe("");
      // Every section that has controls has at least one Tab stop and one measured target.
      const empty = sections
        .filter(
          ({ id, controls }) =>
            controls > 0 && ((stopsBySection[id] ?? 0) === 0 || (small.bySection[id] ?? 0) === 0),
        )
        .map(
          ({ id, controls }) =>
            `#${id}: ${controls} controls, ${stopsBySection[id] ?? 0} stops, ${small.bySection[id] ?? 0} targets`,
        );
      expect(empty.join("\n"), "sections with controls but no stop or target").toBe("");

      // (e) No console error, page error, foreign request or CSP violation.
      // WebKit alone reports a style-src violation on every native <select> (its own control
      // behaviour, see WEBKIT_SELECT_CSP in helpers.ts); that is not ours and is ignored there.
      // Seen in WebKit: violatedDirective "style-src-attr", blockedURI "inline", target select.
      // Anything else, and the same report in Chromium, fails.
      const violations = (await page.evaluate<string[]>("window.__csp")).filter(
        (entry) => !(webkit && /^style-src(-attr|-elem)? inline on select$/.test(entry)),
      );
      expect(violations, "securitypolicyviolation events").toEqual([]);
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
