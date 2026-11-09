// Templates through the web pages (spec 3.10 Templates, decision I43).
import { describe, expect, it } from "vite-plus/test";
import { isSecretLinkPath } from "../../../src/adapters/in/http/routes/secret-links.tsx";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');
const templateLinks = (html: string) =>
  [...html.matchAll(/href="\/templates\/([\w-]+)"/g)].map((m) => m[1]);

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  return { ...test, host };
}

/** Deletes the plan through the host page. */
async function deleteViaUi(client: TestClient, planId: string) {
  const confirm = await (await client.get(`/p/${planId}/host/delete`)).text();
  await client.postForm(`/p/${planId}/host/delete`, hiddenFields(confirm));
  return confirm;
}

describe("keeping a template (spec 3.10)", () => {
  it("is offered on the create form, kept at deletion and listed on the home page", async () => {
    const { host, app } = await setup();
    const form = await (await host.get("/new")).text();
    expect(form).toContain('name="keepAsTemplate" value="1"');
    expect(form).toContain('name="templateIncludePrivate" value="1"');

    const { planId } = await createPlanViaUi(host, { keepAsTemplate: "1", title: "Tuesday tempo" });
    await respondViaUi(new TestClient(app), planId, "Ben", "joined");
    expect(text(await deleteViaUi(host, planId))).toContain(en("host.deleteKeepsTemplate"));

    const home = await host.get("/");
    expect(home.headers.get("cache-control")).toBe("private, no-store");
    const html = await home.text();
    expect(html).toContain(en("home.templates"));
    expect(html).toContain("Tuesday tempo");
    expect(templateLinks(html)).toHaveLength(1);

    const stranger = await new TestClient(app).get("/");
    expect(await stranger.text()).not.toContain(en("home.templates"));
  });
});

describe("the template page (spec 3.10)", () => {
  async function withTemplate() {
    const test = await setup();
    const { planId } = await createPlanViaUi(test.host, { keepAsTemplate: "1" });
    await deleteViaUi(test.host, planId);
    const [templateId = ""] = templateLinks(await (await test.host.get("/")).text());
    return { ...test, templateId };
  }

  it("is private to linked devices", async () => {
    const { host, app, templateId } = await withTemplate();
    const page = await host.get(`/templates/${templateId}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    const html = await page.text();
    expect(html).toContain("Easy Sunday run");
    expect(html).toContain('name="time" type="time" required="" value="07:30"');

    const other = await new TestClient(app).get(`/templates/${templateId}`);
    expect(other.status).toBe(404);
    expect(await other.text()).not.toContain("Easy Sunday run");
  });

  it("repeats the plan on a new date with new links", async () => {
    const { host, templateId } = await withTemplate();
    const fields = hiddenFields(await (await host.get(`/templates/${templateId}`)).text());
    const repeated = await host.postForm(`/templates/${templateId}/repeat`, {
      ...fields,
      date: "2026-07-05",
      time: "08:00",
    });
    expect(repeated.status).toBe(200);
    expect(repeated.headers.get("cache-control")).toBe("no-store");
    const html = await repeated.text();
    expect(html).toContain(en("links.heading"));
    expect(html).toMatch(/https:\/\/runs\.example\.org\/a\/[\w-]{43}/);
    const planId = /https:\/\/runs\.example\.org\/p\/([\w-]{22})/.exec(html)?.[1] ?? "";
    expect(await (await host.get(`/p/${planId}`)).text()).toContain("Easy Sunday run");

    const past = await host.postForm(`/templates/${templateId}/repeat`, {
      ...fields,
      nonce: "another-nonce-0000000",
      date: "2026-05-01",
      time: "08:00",
    });
    expect(past.status).toBe(422);
    expect(await past.text()).toContain('value="2026-05-01"');
  });

  it("is edited without a date or template options, and deleted", async () => {
    const { host, templateId } = await withTemplate();
    const form = await (await host.get(`/templates/${templateId}/edit`)).text();
    expect(form).not.toContain('name="date"');
    expect(form).not.toContain('name="keepAsTemplate"');
    expect(form).toContain('name="time"');

    const edited = await host.postForm(`/templates/${templateId}/edit`, {
      ...hiddenFields(form),
      posterName: "Anna",
      activity: "run",
      title: "Long run",
      time: "06:45",
      timeZone: "Europe/Berlin",
      areaLabel: "Englischer Garten",
      dropPolicy: "no_drop",
      primaryColor: "#2E5BFF",
      secondaryColor: "#FF7A45",
      retentionDays: "14",
    });
    expect(edited.headers.get("location")).toBe(`/templates/${templateId}?saved`);
    const page = await (await host.get(`/templates/${templateId}?saved`)).text();
    expect(page).toContain("Long run");
    expect(page).toContain(en("template.saved"));

    const deleted = await host.postForm(`/templates/${templateId}/delete`, hiddenFields(page));
    expect(deleted.headers.get("location")).toBe("/");
    expect((await host.get(`/templates/${templateId}`)).status).toBe(404);
  });
});

describe("saving a live plan as template (spec 3.10)", () => {
  it("shows a template link once, which links another device after confirmation", async () => {
    const { host, app } = await setup();
    const { planId } = await createPlanViaUi(host);
    const hostPage = await (await host.get(`/p/${planId}/host`)).text();
    expect(hostPage).toContain(`action="/p/${planId}/host/template"`);

    const fields = hiddenFields(hostPage);
    const saved = await host.postForm(`/p/${planId}/host/template`, fields);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    expect(saved.headers.get("referrer-policy")).toBe("no-referrer");
    const path = /https:\/\/runs\.example\.org(\/t\/[\w-]{43})/.exec(await saved.text())?.[1] ?? "";
    // Sent again (reload, back button): no second template, back to the first one.
    const again = await host.postForm(`/p/${planId}/host/template`, fields);
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toMatch(/^\/templates\/[\w-]+$/);
    expect(path).not.toBe("");

    const other = new TestClient(app);
    const confirm = await other.get(path);
    expect(text(await confirm.text())).toContain(
      en("templateLink.body", { title: "Easy Sunday run" }),
    );
    const linked = await other.postForm("/t", hiddenFields(await (await other.get(path)).text()));
    const location = linked.headers.get("location") ?? "";
    expect(location).toMatch(/^\/templates\/[\w-]+$/);
    expect((await other.get(location)).status).toBe(200);
    // The plan itself stays the host's.
    expect((await other.get(`/p/${planId}/host`)).status).not.toBe(200);
  });

  it("refuses devices that do not host the plan", async () => {
    const { host, app } = await setup();
    const { planId } = await createPlanViaUi(host);
    const other = new TestClient(app);
    const csrf = hiddenFields(await (await other.get(`/p/${planId}`)).text())._csrf ?? "";
    const refused = await other.postForm(`/p/${planId}/host/template`, { _csrf: csrf });
    expect(refused.headers.get("location")).toBe(`/p/${planId}`);
  });

  it("keeps template links out of other URLs", () => {
    expect(isSecretLinkPath("/t/abc")).toBe(true);
    expect(isSecretLinkPath("/templates/abc")).toBe(false);
  });
});
