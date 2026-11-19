// The host page's save bar (decision 006): markup only. The sticky look is CSS (test/design) and
// the dirty tracking is the page script (test/client, e2e/save-bar.spec.ts).
import { describe, expect, it } from "vite-plus/test";
import { en } from "../../../src/adapters/i18n/messages/en.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, editForm, uploadViaEdit } from "../../support/plans.ts";

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  return { host, planId };
}

/** The bar's markup, from its first attribute to the end of its form. */
function barOf(html: string): string {
  const start = html.indexOf('data-save-bar=""');
  return html.slice(start, html.indexOf("</form>", start));
}

describe("save bar markup", () => {
  it("wraps the one Save button on the edit form, with status and Discard hidden", async () => {
    const { host, planId } = await setup();
    const html = await (await host.get(`/p/${planId}/host`)).text();
    expect(html.match(/data-save-bar=""/g)).toHaveLength(1);
    expect(html.match(new RegExp(escaped(en["host.save"]), "g"))).toHaveLength(1);
    // A clean form: no sticky state, no problem state.
    const bar = barOf(html);
    expect(bar).not.toContain("data-dirty");
    expect(bar).not.toContain("data-problem");
    expect(bar).toMatch(/<span data-save-bar-unsaved="" hidden="">/);
    expect(bar).toContain(escaped(en["saveBar.unsaved"]));
    expect(bar).toMatch(/<button[^>]*data-save-bar-discard=""[^>]*hidden=""/);
    expect(bar).toContain(escaped(en["saveBar.discard"]));
    expect(bar).toContain('role="status"');
    expect(bar).not.toContain('role="alert"');
    // Save comes first: it keeps its place in the row.
    expect(bar.indexOf('type="submit"')).toBeLessThan(bar.indexOf("data-save-bar-unsaved"));
  });

  it("is not on the create form", async () => {
    const { host } = await setup();
    const html = await (await host.get("/new")).text();
    expect(html).not.toContain("data-save-bar");
    expect(html).not.toContain(escaped(en["saveBar.discard"]));
  });

  it("shows the problem state from the start when the server found errors", async () => {
    const { host, planId } = await setup();
    const fields = await editForm(host, planId);
    const response = await host.postForm(`/p/${planId}/host`, { ...fields, title: "" });
    expect(response.status).toBe(422);
    const html = await response.text();
    const bar = barOf(html);
    expect(bar).toMatch(/^data-save-bar="" data-dirty="" data-problem=""/);
    expect(bar).toContain('role="alert"');
    expect(bar).toContain("1 problem to fix");
    expect(bar).toContain('href="#field-title"');
    expect(bar).toContain(`Go to ${escaped(en["form.title"])}`);
    // The link target exists, and the existing error rendering is reused.
    expect(html).toContain('id="field-title"');
    expect(html).toContain(escaped(en["field.required"]));
  });

  it("counts the fields with a problem and links to a field with no control of its own", async () => {
    const { host, planId } = await setup();
    const fields = await editForm(host, planId);
    const response = await host.postForm(`/p/${planId}/host`, {
      ...fields,
      joinMode: "bogus",
      title: "",
    });
    const html = await response.text();
    const bar = barOf(html);
    expect(bar).toContain("2 problems to fix");
    expect(bar).toContain('href="#field-title"');
    const target = html.indexOf('id="field-joinMode-error"');
    expect(target).toBeGreaterThan(0);
  });

  it("names the route file when only the file was refused (decision D10)", async () => {
    const { host, planId } = await setup();
    const response = await uploadViaEdit(host, planId, "not a route");
    expect(response.status).toBe(422);
    const html = await response.text();
    const bar = barOf(html);
    expect(bar).toMatch(/^data-save-bar="" data-dirty="" data-problem=""/);
    expect(bar).toContain("1 problem to fix");
    expect(bar).toContain('href="#field-gpx"');
    expect(bar).toContain(`Go to ${escaped(en["form.gpx"])}`);
    expect(html).toContain('id="field-gpx"');
  });
});
