// Reporting a plan through the web pages, and the reports on the admin pages (spec 7 Moderation,
// decision I47; plan v1.0 step 2).
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";
import { runRetentionSweep } from "../../../src/application/maintenance.ts";

const en = translator("en");
const TOKEN = "admin-token-for-tests-0123456789abcdef";
const AFTER_START = "2026-06-07T06:00:00Z";
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');

async function setup(env: Record<string, string> = { ADMIN_TOKEN: TOKEN }) {
  const test = await createTestApp({ env });
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  return { ...test, host, planId, admin: new TestClient(test.app) };
}

async function logIn(admin: TestClient) {
  const fields = hiddenFields(await (await admin.get("/admin/login")).text());
  await admin.postForm("/admin/login", { ...fields, token: TOKEN });
}

/** Sends the report form as the page gives it, with these choices. */
async function report(
  client: TestClient,
  planId: string,
  fields: { reason?: string; details?: string; attach?: string[] } = {},
) {
  const form = hiddenFields(await (await client.get(`/p/${planId}/report`)).text());
  const body = new URLSearchParams({
    ...form,
    reason: fields.reason ?? "unsafe",
    details: fields.details ?? "",
  });
  for (const id of fields.attach ?? []) body.append("attach", id);
  return client.postForm(`/p/${planId}/report`, body);
}

/** The IDs of the recap posts the report form offers. */
const attachable = (html: string) =>
  [...html.matchAll(/name="attach" value="([^"]+)"/g)].map((match) => match[1] ?? "");

describe("reporting a plan (spec 7 Moderation)", () => {
  it("is not offered without admin authentication", async () => {
    const { host, planId } = await setup({});
    expect(await (await host.get(`/p/${planId}`)).text()).not.toContain(`/p/${planId}/report`);
    expect((await host.get(`/p/${planId}/report`)).status).toBe(404);
    const _csrf = hiddenFields(await (await host.get(`/p/${planId}`)).text())._csrf ?? "";
    const posted = await host.postForm(`/p/${planId}/report`, { _csrf, reason: "spam" });
    expect(posted.status).toBe(404);
  });

  it("is offered to everyone on the plan page, with a private, unindexed form", async () => {
    const { app, host, planId } = await setup();
    for (const client of [host, new TestClient(app)]) {
      expect(await (await client.get(`/p/${planId}`)).text()).toContain(
        `href="/p/${planId}/report"`,
      );
    }
    const form = await new TestClient(app).get(`/p/${planId}/report`);
    expect(form.status).toBe(200);
    expect(form.headers.get("cache-control")).toBe("private, no-store");
    expect(form.headers.get("x-robots-tag")).toBe("noindex");
    const html = text(await form.text());
    for (const reason of ["spam", "inappropriate", "unsafe", "other"]) {
      expect(html).toContain(`value="${reason}"`);
    }
    expect(html).toContain(en("report.intro"));
    expect((await new TestClient(app).get("/p/AAAAAAAAAAAAAAAAAAAAAA/report")).status).toBe(404);
  });

  it("sends a report without setting any cookie or linking the reporter", async () => {
    const { app, planId, database } = await setup();
    const viewer = new TestClient(app);
    const sent = await report(viewer, planId, { reason: "spam", details: "SENTINEL-details" });
    expect(sent.status).toBe(303);
    expect(sent.headers.get("location")).toBe(`/p/${planId}/report?sent`);
    expect(sent.headers.getSetCookie().filter((c) => !c.startsWith("__Host-rr-csrf"))).toEqual([]);
    expect(viewer.cookies.has("__Host-rr-device")).toBe(false);
    expect(text(await (await viewer.get(`/p/${planId}/report?sent`)).text())).toContain(
      en("report.sent"),
    );
    const columns = database.sqlite
      .prepare("select name from pragma_table_info('reports')")
      .pluck();
    expect(columns.all()).not.toContain("device_id");
  });

  it("lets participants attach only recap posts they can see", async () => {
    const { app, host, planId, clock, admin } = await setup();
    const ben = new TestClient(app);
    await respondViaUi(ben, planId, "Ben", "joined");
    clock.set(AFTER_START);
    const post = async (client: TestClient, body: string) => {
      const _csrf = hiddenFields(await (await client.get(`/p/${planId}`)).text())._csrf ?? "";
      await client.postForm(`/p/${planId}/recap`, { _csrf, body, linkUrl: "" });
    };
    await post(host, "Host post");
    await post(ben, "SENTINEL-ben-post");
    const offered = attachable(await (await ben.get(`/p/${planId}/report`)).text());
    expect(offered).toHaveLength(2);
    expect(attachable(await (await new TestClient(app).get(`/p/${planId}/report`)).text())).toEqual(
      [],
    );
    await report(ben, planId, { attach: [offered[1] ?? ""], details: "" });
    await report(ben, planId, { attach: offered, details: "SENTINEL-both" });
    await logIn(admin);
    const page = await (await admin.get(`/admin/plans/${planId}`)).text();
    const [one, both] = page.split("SENTINEL-both");
    expect(one).toContain("SENTINEL-ben-post");
    expect(one).not.toContain("Host post");
    expect(both).toContain("Host post");
    expect(both).toContain("SENTINEL-ben-post");
    expect(page).not.toContain("Ben<");
  });

  it("shows errors on the form, keeping what was typed", async () => {
    const { app, planId } = await setup();
    const viewer = new TestClient(app);
    const invalid = await report(viewer, planId, {
      reason: "boring",
      details: `SENTINEL ${"x".repeat(1000)}`,
    });
    expect(invalid.status).toBe(422);
    const html = text(await invalid.text());
    expect(html).toContain(en("field.choice_invalid"));
    expect(html).toContain(en("field.too_long"));
    expect(html).toContain("SENTINEL x");
  });

  it("is rate limited, without counting a form sent again", async () => {
    const { app, planId } = await setup();
    const viewer = new TestClient(app);
    const form = hiddenFields(await (await viewer.get(`/p/${planId}/report`)).text());
    const again = { ...form, reason: "spam", details: "" };
    for (let i = 0; i < 3; i++) {
      expect((await viewer.postForm(`/p/${planId}/report`, again)).status).toBe(303);
    }
    expect((await report(viewer, planId)).status).toBe(303);
    expect((await report(viewer, planId)).status).toBe(303);
    expect((await report(viewer, planId)).status).toBe(429);
  });

  it("needs the CSRF token", async () => {
    const { app, planId } = await setup();
    const forged = await new TestClient(app).postForm(`/p/${planId}/report`, { reason: "spam" });
    expect(forged.status).toBe(403);
  });
});

describe("reports on the admin pages (spec 7 Moderation)", () => {
  it("counts open reports, shows them on the plan's page and resolves them", async () => {
    const { app, planId, admin } = await setup();
    await logIn(admin);
    expect(text(await (await admin.get("/admin/")).text())).toContain(
      en("admin.openReports", { count: 0 }),
    );
    await report(new TestClient(app), planId, { reason: "unsafe", details: "SENTINEL-one" });
    await report(new TestClient(app), planId, { reason: "spam", details: "SENTINEL-two" });
    const home = text(await (await admin.get("/admin/")).text());
    expect(home).toContain(en("admin.openReports", { count: 2 }));
    expect(home).toContain(`href="../admin/plans/${planId}#reports"`);
    expect(home).not.toContain("SENTINEL");

    const page = await (await admin.get(`/admin/plans/${planId}`)).text();
    expect(page).toContain("SENTINEL-one");
    expect(page).toContain(en("report.reason.unsafe"));
    const resolve = /action="([^"]*\/resolve)"/.exec(page)?.[1] ?? "";
    expect(resolve).toMatch(/^\.\.\/\.\.\/admin\/reports\/.+\/resolve$/);
    const resolvePath = new URL(resolve, `http://app/admin/plans/${planId}`).pathname;
    const resolved = await admin.postForm(resolvePath, hiddenFields(page));
    expect(resolved.status).toBe(303);
    expect(resolved.headers.get("location")).toBe(`../../../admin/plans/${planId}#reports`);
    // A second click (or a stale page) goes back to the plan; an unknown report says so.
    const again = await admin.postForm(resolvePath, hiddenFields(page));
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe(`../../../admin/plans/${planId}#reports`);
    const unknown = await admin.postForm(
      "/admin/reports/no-such-report/resolve",
      hiddenFields(page),
    );
    expect(unknown.status).toBe(404);
    expect(text(await unknown.text())).toContain(en("admin.reportNotFound"));
    const after = text(await (await admin.get(`/admin/plans/${planId}`)).text());
    expect(after).not.toContain("SENTINEL-one");
    expect(after).toContain("SENTINEL-two");
    expect(after).toContain(en("admin.resolvedReports", { count: 1 }));
    expect(text(await (await admin.get("/admin/")).text())).toContain(
      en("admin.openReports", { count: 1 }),
    );
  });

  it("go with the plan on retention and on the host's own-data deletion (spec 3.10)", async () => {
    const { app, host, planId, database, clock, planDeps } = await setup();
    const reports = () => database.sqlite.prepare("select plan_id from reports").pluck().all();
    await report(new TestClient(app), planId);
    const other = new TestClient(app);
    const second = await createPlanViaUi(other, { title: "Second plan" });
    await report(new TestClient(app), second.planId);
    expect(reports()).toHaveLength(2);

    const ownData = await other.postForm(
      "/my-data/delete",
      hiddenFields(await (await other.get("/my-data/delete")).text()),
    );
    expect(ownData.status).toBe(303);
    expect(reports()).toEqual([planId]);

    // sampleInput is deleted on 21 June 2026.
    clock.set("2026-06-21T05:30:00Z");
    expect(await runRetentionSweep(planDeps)).toEqual({ deletedPlans: 1 });
    expect(reports()).toEqual([]);
    expect((await host.get(`/p/${planId}`)).status).toBe(404);
  });

  it("are gone with the plan", async () => {
    const { app, host, planId, admin, database } = await setup();
    await report(new TestClient(app), planId);
    const confirm = await (await host.get(`/p/${planId}/host/delete`)).text();
    await host.postForm(`/p/${planId}/host/delete`, hiddenFields(confirm));
    expect(database.sqlite.prepare("select count(*) from reports").pluck().get()).toBe(0);
    await logIn(admin);
    expect(text(await (await admin.get("/admin/")).text())).toContain(
      en("admin.openReports", { count: 0 }),
    );
  });
});
