// The dev-only style guide (decision D72, plan 0.13 step 13b): only with ALLOW_INSECURE_DEV, never
// indexed, never linked, never on the admin listener, and it holds every section.
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";

const SECTIONS = [
  "sg-typography",
  "sg-buttons",
  "sg-inputs",
  "sg-choices",
  "sg-notices",
  "sg-folds",
  "sg-title",
  "sg-lines",
  "sg-states",
  "sg-plan-form",
  "sg-header-sheet",
  "sg-footer",
  "sg-badges",
  "sg-map-dialog",
  "sg-theme-colors",
];

const DEV = { ALLOW_INSECURE_DEV: "true", BASE_URL: "http://localhost:3000" };
const TOKEN = "admin-token-for-tests-0123456789abcdef";

async function guide(env: Record<string, string> = DEV) {
  const { app } = await createTestApp({ env });
  const response = await new TestClient(app).get("/styleguide");
  return { app, response, html: await response.text() };
}

describe("the style guide with ALLOW_INSECURE_DEV off", () => {
  it("answers 404 like any unknown path, with no section in it", async () => {
    const { app } = await createTestApp();
    const client = new TestClient(app);
    const unknown = await client.get("/no-such-page");
    const response = await client.get("/styleguide");
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).not.toContain("sg-");
    expect(unknown.status).toBe(404);
  });
});

describe("the style guide with ALLOW_INSECURE_DEV on", () => {
  it("renders every section exactly once", async () => {
    const { response, html } = await guide();
    expect(response.status).toBe(200);
    for (const id of SECTIONS) {
      expect(html.split(`id="${id}"`).length - 1).toBe(1);
      expect(html).toMatch(new RegExp(`<section[^>]*id="${id}"[^>]*>\\s*<h2`));
    }
  });

  it("shows every field type in every state in the inputs section (decision D73)", async () => {
    const { html } = await guide();
    const start = html.indexOf('id="sg-inputs"');
    const section = html.slice(start, html.indexOf('id="sg-choices"'));
    const states = {
      text: ["rest", "filled", "required", "error", "disabled"],
      email: ["rest", "filled", "required", "error", "disabled"],
      search: ["rest", "filled", "required", "error", "disabled"],
      textarea: ["rest", "filled", "required", "error", "disabled"],
      select: ["rest", "filled", "required", "error", "disabled"],
      date: ["rest", "filled", "required", "error", "disabled"],
      time: ["rest", "filled", "required", "error", "disabled"],
      file: ["rest", "required", "error", "disabled"],
      color: ["rest", "error", "disabled"],
    };
    for (const [kind, list] of Object.entries(states)) {
      for (const state of list) {
        expect(section, `${kind} ${state}`).toContain(`id="sg-${kind}-${state}"`);
      }
    }
    // A required, empty sample has the red hint after it; an error sample has its message instead.
    expect(section).toContain(
      '<p class="required-hint" id="sg-text-required-required" aria-hidden="true">',
    );
    expect(section).not.toContain('id="sg-text-error-required"');
    expect(section).toContain('id="sg-text-error-error"');
    // The ids of one section are unique, so the labels and descriptions point at one control.
    const ids = [...section.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    // No pencil and no line wrapper on any sample.
    expect(section).not.toMatch(/pencil|line-pen|line-field/);
  });

  it("shows read-only samples that CSS can tell from disabled ones (plan I100)", async () => {
    const { html } = await guide();
    const section = html.slice(html.indexOf('id="sg-inputs"'), html.indexOf('id="sg-choices"'));
    for (const kind of ["text", "textarea"]) {
      for (const state of ["readonly", "readonly-empty", "readonly-required"]) {
        const id = `sg-${kind}-${state}`;
        const tag = new RegExp(`<(?:input|textarea)\\b[^>]*\\bid="${id}"[^>]*>`).exec(section)?.[0];
        expect(`${id}: ${tag}`).toMatch(/\sreadonly(?:=""|\s|\/|>)/);
        expect(`${id}: ${tag}`).not.toMatch(/\sdisabled/);
      }
    }
  });

  it("shows the merged area row, the suggestion hints and an open-able item action fold (plan I100)", async () => {
    const { html } = await guide();
    const section = html.slice(html.indexOf('id="sg-states"'), html.indexOf('id="sg-plan-form"'));
    for (const state of ["rest", "required", "filled", "error", "error-empty", "no-script"]) {
      expect(section.includes(`id="sg-area-${state}"`)).toBe(true);
    }
    expect(section.match(/<div class="field field-invalid">/g)?.length).toBe(2);
    // The magnifier is revealed in every state but "no-script".
    expect(section.match(/class="line-action-button" hidden/g)?.length).toBe(1);
    expect(section.match(/data-label-suggested/g)?.length).toBe(2);
    expect(section.match(/data-description-suggested/g)?.length).toBe(2);
    expect(section).toMatch(/<p class="hint" data-label-suggested="" [^>]*><\/p>/);
    expect(section).toMatch(/<div class="item-actions">[\s\S]*<details class="link-tools">/);
    expect(section).toContain('<p class="back-link">');
  });

  it("shows the icon button on a line in the lines section (D75)", async () => {
    const { html } = await guide();
    const section = html.slice(html.indexOf('id="sg-lines"'), html.indexOf('id="sg-plan-form"'));
    expect(section).toContain('<div class="inline-input line-action">');
    expect(section).toContain(
      '<button type="button" class="line-action-button"><span class="icon icon-search" aria-hidden="true"></span><span class="visually-hidden">Search</span></button>',
    );
  });

  it("shows the full-screen plan map's head and key as a static block, no dialog (ADR 008)", async () => {
    const { html } = await guide();
    const section = html.slice(
      html.indexOf('id="sg-map-dialog"'),
      html.indexOf('id="sg-theme-colors"'),
    );
    // A plain div: a <dialog> would stay closed, and a name on a div is not allowed.
    expect(section).toContain('<div class="map-dialog map-dialog-plan sg-map-dialog">');
    expect(section).not.toContain("<dialog");
    expect(section).not.toContain("<template");
    expect(section).not.toMatch(/aria-labelledby|data-close-label|data-locate-/);
    expect(section).toContain(
      '<h2 class="map-dialog-title" id="sg-map-dialog-plan-title">Easy Sunday run</h2>',
    );
    // The start with the plan's time zone, as the plan page shows it.
    expect(section).toMatch(
      /<p class="map-dialog-when">Sun, 7 Jun 2031, 07:30 <span class="time-zone" data-time-zone="Europe\/Berlin">\(Europe\/Berlin time\)<\/span><\/p>/,
    );
    // The key with all three entries; no Leaflet map element stands in the stage.
    expect([...section.matchAll(/<li data-legend="(\w+)">/g)].map((m) => m[1])).toEqual([
      "area",
      "exact",
      "route",
    ]);
    expect(section).not.toContain("map-dialog-map");
  });

  it("shows the form map's and Nearby's full-screen chrome too, with their hidden parts revealed (ADR 008)", async () => {
    const { html } = await guide();
    const section = html.slice(
      html.indexOf('id="sg-map-dialog"'),
      html.indexOf('id="sg-theme-colors"'),
    );
    for (const kind of ["plan", "pick", "nearby"]) {
      expect(section).toContain(`<div class="map-dialog map-dialog-${kind} sg-map-dialog">`);
    }
    expect(section).not.toMatch(/aria-label="Full-screen map"|data-close-label/);
    // The form map's: its own radio group and ids, the exact start shown as set, Remove point.
    expect(section).toContain('id="sg-map-dialog-pick-mode-area" name="mapModeFull"');
    expect(section).toContain('<span data-status="exact">Exact start set</span>');
    expect(section).toContain('<span data-status="none" hidden="">No point set yet</span>');
    expect(section).toContain(
      '<button type="button" class="map-dialog-remove" data-point-remove="">Remove point</button>',
    );
    // Nearby's: the place search with its own id, the chosen-spot line and Use my location shown.
    expect(section).toContain('for="sg-map-dialog-nearby-place"');
    expect(section).toContain('<p class="map-dialog-status" data-nearby-status="">');
    expect(section).toContain(
      '<button type="button" class="secondary" data-dialog-locate="">Use my location</button>',
    );
    expect(section.split('class="map-dialog-done"').length - 1).toBe(2);
  });

  it("shows the quiet remove icon button in the status line sample (D76)", async () => {
    const { html } = await guide();
    const section = html.slice(html.indexOf('id="sg-lines"'), html.indexOf('id="sg-plan-form"'));
    expect(section).toContain(
      '<button type="button" class="icon-button"><span class="icon icon-close" aria-hidden="true"></span><span class="visually-hidden">Remove</span></button>',
    );
  });

  it("gives every disabled sample a reason line that its control is described by (D74)", async () => {
    const { html } = await guide();
    const section = html.slice(html.indexOf('id="sg-inputs"'), html.indexOf('id="sg-choices"'));
    for (const kind of [
      "text",
      "email",
      "search",
      "textarea",
      "select",
      "date",
      "time",
      "file",
      "color",
    ]) {
      const id = `sg-${kind}-disabled`;
      const tag = new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bid="${id}"[^>]*>`).exec(
        section,
      )?.[0];
      expect(tag).toBeDefined();
      expect(tag).toMatch(/\sdisabled(?:=""|\s|\/|>)/);
      expect(tag).toContain(`aria-describedby="${id}-reason"`);
      expect(section).toMatch(new RegExp(`<p class="hint" id="${id}-reason">[^<]+</p>`));
    }
  });

  it("shows example placeholders in the empty text-like samples, at rest and disabled (D74)", async () => {
    const { html } = await guide();
    const section = html.slice(html.indexOf('id="sg-inputs"'), html.indexOf('id="sg-choices"'));
    for (const kind of ["text", "email", "search", "textarea"]) {
      for (const state of ["rest", "disabled"]) {
        const id = `sg-${kind}-${state}`;
        const tag = new RegExp(`<(?:input|textarea)\\b[^>]*\\bid="${id}"[^>]*>`).exec(section)?.[0];
        expect(tag).toMatch(/placeholder="[^" ][^"]*"/);
      }
    }
  });

  it("never names a required hint in aria-describedby, and every named id exists", async () => {
    const { html } = await guide();
    const present = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const named = [...html.matchAll(/\saria-describedby="([^"]*)"/g)].flatMap((m) =>
      (m[1] ?? "").split(" "),
    );
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((id) => id.endsWith("-required"))).toEqual([]);
    expect(named.filter((id) => !present.has(id))).toEqual([]);
  });

  it("has aria-required but no required hint element on date and time (D74)", async () => {
    const { html } = await guide();
    const section = html.slice(html.indexOf('id="sg-inputs"'), html.indexOf('id="sg-choices"'));
    for (const kind of ["date", "time"]) {
      const id = `sg-${kind}-required`;
      const tag = new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`).exec(section)?.[0] ?? "";
      expect(tag).toContain('aria-required="true"');
      expect(tag).not.toContain("placeholder");
      expect(tag).not.toContain("aria-describedby");
      expect(section).not.toContain(`id="${id}-required"`);
    }
  });

  it("has no id twice, and every reference points at an id on the page (plan I98)", async () => {
    const { html } = await guide();
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? "");
    const present = new Set(ids);
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect([...new Set(repeated)]).toEqual([]);
    const references = (pattern: RegExp) =>
      [...html.matchAll(pattern)].flatMap((match) => (match[1] ?? "").split(/\s+/).filter(Boolean));
    const lists = {
      for: references(/\sfor="([^"]*)"/g),
      "aria-describedby": references(/\saria-describedby="([^"]*)"/g),
      "aria-labelledby": references(/\saria-labelledby="([^"]*)"/g),
      "aria-controls": references(/\saria-controls="([^"]*)"/g),
      popovertarget: references(/\spopovertarget="([^"]*)"/g),
      list: references(/\slist="([^"]*)"/g),
      form: references(/\sform="([^"]*)"/g),
      "aria-owns": references(/\saria-owns="([^"]*)"/g),
      "aria-errormessage": references(/\saria-errormessage="([^"]*)"/g),
      "aria-activedescendant": references(/\saria-activedescendant="([^"]*)"/g),
      href: references(/\shref="#([^"]+)"/g),
    };
    for (const [attribute, values] of Object.entries(lists)) {
      expect({ [attribute]: values.filter((value) => !present.has(value)) }).toEqual({
        [attribute]: [],
      });
    }
    // The four forms have their own prefixes; the real pages keep the plain one.
    for (const prefix of ["sg-create", "sg-errors", "sg-filled", "sg-host"]) {
      expect(present.has(`${prefix}-time`)).toBe(true);
    }
    expect(present.has("field-time")).toBe(false);
  });

  it("is not indexed or stored", async () => {
    const { response, html } = await guide();
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(html).toContain('<meta name="robots" content="noindex"/>');
  });

  it("keeps the app's strict CSP and uses no inline style or script", async () => {
    const { response, html } = await guide();
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<style[\s>]/);
    // Scripts only with a src.
    expect([...html.matchAll(/<script\b[^>]*>/g)].every((m) => /\ssrc="/.test(m[0]))).toBe(true);
    expect(html).toMatch(
      /<link rel="stylesheet" href="\/static\/styleguide\.css\?v=[0-9a-f]{10}"\/>/,
    );
    expect(html).toMatch(/<link rel="stylesheet" href="\/static\/app\.css\?v=[0-9a-f]{10}"\/>/);
  });

  it("shows the real plan form in five states, two with the save bar", async () => {
    const { html } = await guide();
    expect(html.split('class="plan-form"').length - 1).toBe(5);
    expect(html.split('data-save-bar=""').length - 1).toBe(2);
    expect(html).toContain("fold fold-warning");
  });

  it("shows the route in the host samples: Remove route… with its separate form, and a file error (D10)", async () => {
    const { html } = await guide();
    for (const prefix of ["sg-host", "sg-host-errors"]) {
      expect(html).toContain(`form="${prefix}-route-remove"`);
      expect(html).toMatch(new RegExp(`<form id="${prefix}-route-remove"[^>]*hidden`));
    }
    expect(html.split('class="danger-zone remove-route"').length - 1).toBe(2);
    const errors = html.slice(html.indexOf('id="sg-host-errors-title"'));
    expect(errors).toContain('id="sg-host-errors-gpx-error"');
    expect(errors).toContain('id="sg-host-errors-gpx-again"');
    const bar = errors.slice(errors.indexOf('data-save-bar=""'));
    expect(bar).toContain('href="#sg-host-errors-gpx"');
    expect(bar).toContain("Go to Route (GPX file, optional)");
  });

  it("shows a fold that hides its summary when open (D79)", async () => {
    const { html } = await guide();
    expect(html).toContain("Summary only when closed");
    expect(html).toContain("fold-hide-open");
  });

  it("is not linked from the home or privacy pages", async () => {
    const { app } = await guide();
    const client = new TestClient(app);
    for (const path of ["/", "/privacy", "/new"]) {
      expect(await (await client.get(path)).text()).not.toContain("styleguide");
    }
  });

  it("is not on the admin listener", async () => {
    const test = await createTestApp({
      env: { ...DEV, ADMIN_TOKEN: TOKEN, ADMIN_PORT: "3001" },
    });
    if (test.adminApp === undefined) throw new Error("no admin app");
    const response = await new TestClient(test.adminApp).get("/styleguide");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("sg-");
  });
});
