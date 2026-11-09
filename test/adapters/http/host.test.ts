import { describe, expect, it } from "vite-plus/test";
import { en } from "../../../src/adapters/i18n/messages/en.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  return { ...test, host, planId, newClient: () => new TestClient(test.app) };
}

/** All form fields of the host page's edit form (hidden and visible inputs, selects, textareas). */
async function editForm(client: TestClient, planId: string): Promise<Record<string, string>> {
  const html = await (await client.get(`/p/${planId}/host`)).text();
  const form = /<form[^>]*action="\/p\/[^"]+\/host"[^>]*>([\s\S]*?)<\/form>/.exec(html)?.[1] ?? "";
  const fields: Record<string, string> = {};
  for (const input of form.matchAll(/<input[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(input[0])?.[1];
    const value = /value="([^"]*)"/.exec(input[0])?.[1] ?? "";
    const type = /type="([^"]+)"/.exec(input[0])?.[1];
    if (
      name === undefined ||
      ((type === "radio" || type === "checkbox") && !/checked/.test(input[0]))
    )
      continue;
    fields[name] = value
      .replaceAll("&amp;", "&")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  }
  for (const select of form.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    fields[select[1] ?? ""] =
      /<option value="([^"]*)" selected=""/.exec(select[2] ?? "")?.[1] ?? "";
  }
  for (const area of form.matchAll(/<textarea[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
    fields[area[1] ?? ""] = (area[2] ?? "")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  }
  return fields;
}

describe("host page access (spec 5 feature 7)", () => {
  it("is only for the host; everyone else is sent to the plan", async () => {
    const { planId, newClient } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");
    for (const client of [newClient(), ben]) {
      const response = await client.get(`/p/${planId}/host`);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`/p/${planId}`);
    }
  });

  it("is linked from the host's plan page", async () => {
    const { host, planId } = await setup();
    expect(await (await host.get(`/p/${planId}`)).text()).toContain(`href="/p/${planId}/host"`);
  });
});

describe("editing (spec 3.1)", () => {
  it("prefills the form and saves changes", async () => {
    const { host, planId } = await setup();
    const fields = await editForm(host, planId);
    expect(fields.title).toBe("Easy Sunday run");
    expect(fields.exactDescription).toBe("North gate, by the bike racks");
    const saved = await host.postForm(`/p/${planId}/host`, {
      ...fields,
      title: "Longer Sunday run",
    });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(`/p/${planId}/host?saved`);
    expect(await (await host.get(`/p/${planId}`)).text()).toContain("Longer Sunday run");
  });

  it("re-renders with errors", async () => {
    const { host, planId } = await setup();
    const fields = await editForm(host, planId);
    const response = await host.postForm(`/p/${planId}/host`, { ...fields, title: "" });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(escaped(en["field.required"]));
  });

  it("offers only retention and the recap window after the start, and confirms a deletion that would happen now", async () => {
    const { host, planId, clock } = await setup();
    clock.set("2026-06-09T00:00:00Z");
    const fields = await editForm(host, planId);
    expect(Object.keys(fields).sort()).toEqual(["_csrf", "recapWindow", "retentionDays"]);

    const ask = await host.postForm(`/p/${planId}/host`, { ...fields, retentionDays: "1" });
    expect(ask.status).toBe(200);
    const confirmPage = await ask.text();
    expect(confirmPage).toContain(escaped(en["host.deletesNowWarning"]));

    const confirmed = await host.postForm(`/p/${planId}/host`, hiddenFields(confirmPage));
    expect(confirmed.status).toBe(303);
    expect((await host.get(`/p/${planId}`)).status).toBe(404);
  });
});

describe("removing people (spec 3.5)", () => {
  it("removes and restores a participant", async () => {
    const { host, planId, newClient } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");
    const page = await (await host.get(`/p/${planId}/host`)).text();
    const removeAction = /action="(\/p\/[^"]+\/host\/people\/[^"]+\/remove)"/.exec(page)?.[1] ?? "";
    expect(removeAction).not.toBe("");

    const removed = await host.postForm(removeAction, hiddenFields(page));
    expect(removed.status).toBe(303);
    expect(await (await ben.get(`/p/${planId}`)).text()).not.toContain("North gate");

    const after = await (await host.get(`/p/${planId}/host`)).text();
    const restoreAction =
      /action="(\/p\/[^"]+\/host\/people\/[^"]+\/restore)"/.exec(after)?.[1] ?? "";
    expect((await host.postForm(restoreAction, hiddenFields(after))).status).toBe(303);
    expect(await (await ben.get(`/p/${planId}`)).text()).toContain("North gate");
  });
});

describe("cancelling (spec 5 feature 8, decision D8)", () => {
  it("shows the banner, closes responses and leaves only retention and the recap window editable", async () => {
    const { host, planId, newClient } = await setup();
    const page = await (await host.get(`/p/${planId}/host`)).text();
    expect((await host.postForm(`/p/${planId}/host/cancel`, hiddenFields(page))).status).toBe(303);

    const viewerHtml = await (await newClient().get(`/p/${planId}`)).text();
    expect(viewerHtml).toContain(escaped(en["plan.cancelled"]));
    expect(viewerHtml).not.toContain('name="displayName"');
    expect(Object.keys(await editForm(host, planId)).sort()).toEqual([
      "_csrf",
      "recapWindow",
      "retentionDays",
    ]);
  });
});

describe("deleting (spec 5 feature 9)", () => {
  it("confirms with a list of what is removed, then deletes for good", async () => {
    const { host, planId, newClient } = await setup();
    await respondViaUi(newClient(), planId, "Ben", "joined");
    const confirm = await host.get(`/p/${planId}/host/delete`);
    const html = await confirm.text();
    expect(html).toContain(escaped(en["host.deleteExplain"].one.replace("{count}", "1")));

    const deleted = await host.postForm(`/p/${planId}/host/delete`, hiddenFields(html));
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe(`/p/${planId}`);
    const gone = await host.get(`/p/${planId}`);
    expect(gone.status).toBe(404);
    expect(await gone.text()).toContain(escaped(en["plan.gone"]));
    expect((await host.get(`/p/${planId}/host`)).status).toBe(404);
  });

  it("requires a CSRF token (spec 3.8)", async () => {
    const { host, planId } = await setup();
    expect((await host.postForm(`/p/${planId}/host/delete`, {})).status).toBe(403);
    expect((await host.get(`/p/${planId}`)).status).toBe(200);
  });
});

describe("retention above a lowered maximum (spec 3.10)", () => {
  it("keeps the plan's promised retention when the host saves other changes", async () => {
    const test = await createTestApp({ env: { MAX_RETENTION_DAYS: "7" } });
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, { retentionDays: "7" });
    // As if created before the owner lowered MAX_RETENTION_DAYS from 30 to 7.
    test.database.sqlite
      .prepare("update plans set retention_days = 30, delete_at = '2026-07-07T05:30:00.000Z'")
      .run();

    const fields = await editForm(host, planId);
    expect(fields.retentionDays).toBe("30");
    expect((await host.postForm(`/p/${planId}/host`, { ...fields, title: "Renamed" })).status).toBe(
      303,
    );
    const row = test.database.sqlite.prepare("select title, retention_days from plans").get();
    expect(row).toEqual({ title: "Renamed", retention_days: 30 });
  });
});
