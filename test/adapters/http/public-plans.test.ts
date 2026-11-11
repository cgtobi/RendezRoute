// Public plans through the pages (spec 3.3, 7 Visibility and Nearby plans; decision D35): the
// choice on the create, edit and template forms, the label in the plan header, the privacy notice.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, editForm, planForm } from "../../support/plans.ts";
import { FakeOidcServer } from "../../fakes/oidc-server.ts";

const en = translator("en");
const PUBLIC_RADIO = 'name="visibility" value="public"';
const LABEL = `<span class="icon icon-globe" aria-hidden="true"></span>${escaped(en("plan.public"))}`;

async function setup(env: Record<string, string> = {}) {
  const oidc = new FakeOidcServer();
  const test = await createTestApp({ env: { ...oidc.env(), ...env }, oidc });
  return { ...test, oidc };
}

async function logIn(client: TestClient, oidc: FakeOidcServer) {
  const started = await client.get("/login/oidc");
  const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), {
    sub: "anna",
    name: "Anna",
  });
  await client.get(`${callback.pathname}${callback.search}`);
}

const page = async (client: TestClient, path: string) => (await client.get(path)).text();

describe("choosing public on the create form (decision D35)", () => {
  it("offers public to a logged-in poster, and the plan header says so to everyone", async () => {
    const { app, oidc } = await setup();
    const anna = new TestClient(app);
    await logIn(anna, oidc);
    const form = await page(anna, "/new");
    expect(form).toContain(escaped(en("form.visibility")));
    expect(form).not.toContain(`${PUBLIC_RADIO} disabled`);
    const { planId } = await createPlanViaUi(anna, { visibility: "public" });
    expect(await page(new TestClient(app), `/p/${planId}`)).toContain(LABEL);
  });

  it("asks to log in first, and refuses public without an account", async () => {
    const { app } = await setup();
    const ben = new TestClient(app);
    const form = await page(ben, "/new");
    expect(form).toContain(`${PUBLIC_RADIO} disabled=""`);
    expect(form).toContain(`${escaped(en("form.publicNeedsLogin"))} <a href="/account">`);
    const hidden = await ben.hiddenFields("/new");
    const refused = await ben.postForm("/new", {
      ...hidden,
      ...planForm({ visibility: "public" }),
    });
    expect(refused.status).toBe(422);
    const shownAgain = await refused.text();
    expect(shownAgain).toContain(escaped(en("field.public_needs_login")));
    // What the form shows is what it sends: link-only, never a ticked radio that is not sent.
    expect(shownAgain).toContain('name="visibility" value="link" checked=""');
    expect(shownAgain).not.toContain(`${PUBLIC_RADIO} checked`);
  });

  it("shows no choice where public can never be chosen: login required, none offered", async () => {
    const { app } = await createTestApp();
    const form = await page(new TestClient(app), "/new");
    expect(form).not.toContain(escaped(en("form.visibility")));
    const { planId } = await createPlanViaUi(new TestClient(app));
    expect(await page(new TestClient(app), `/p/${planId}`)).not.toContain(LABEL);
  });

  it("lets anyone choose public with PUBLIC_REQUIRES_LOGIN=false", async () => {
    const { app } = await createTestApp({ env: { PUBLIC_REQUIRES_LOGIN: "false" } });
    const ben = new TestClient(app);
    expect(await page(ben, "/new")).not.toContain(`${PUBLIC_RADIO} disabled`);
    const { planId } = await createPlanViaUi(ben, { visibility: "public" });
    expect(await page(ben, `/p/${planId}`)).toContain(LABEL);
  });
});

describe("changing it on the host page", () => {
  it("narrows a public plan back to people with the link", async () => {
    const { app, oidc } = await setup();
    const anna = new TestClient(app);
    await logIn(anna, oidc);
    const { planId } = await createPlanViaUi(anna, { visibility: "public" });
    expect(await page(anna, `/p/${planId}/host`)).toContain(`${PUBLIC_RADIO} checked=""`);
    const fields = await editForm(anna, planId);
    expect(fields.visibility).toBe("public");
    const saved = await anna.postForm(`/p/${planId}/host`, { ...fields, visibility: "link" });
    expect(saved.status).toBe(303);
    expect(await page(anna, `/p/${planId}`)).not.toContain(LABEL);
  });
});

describe("a co-host's host page", () => {
  it("offers public for the account's plan, also on a device that is not logged in", async () => {
    const { app, oidc } = await setup();
    const anna = new TestClient(app);
    await logIn(anna, oidc);
    const { planId, hostPath } = await createPlanViaUi(anna);
    const cohost = new TestClient(app);
    await cohost.postForm("/a", await cohost.hiddenFields(hostPath));
    const host = await page(cohost, `/p/${planId}/host`);
    expect(host).toContain(PUBLIC_RADIO);
    expect(host).not.toContain(`${PUBLIC_RADIO} disabled`);
  });
});

describe("repeating a public template", () => {
  it("tells the poster when the new plan is set back to people with the link", async () => {
    const test = await createTestApp({ env: { PUBLIC_REQUIRES_LOGIN: "false" } });
    const ben = new TestClient(test.app);
    const { planId } = await createPlanViaUi(ben, { visibility: "public", keepAsTemplate: "1" });
    const confirm = await page(ben, `/p/${planId}/host/delete`);
    await ben.postForm(`/p/${planId}/host/delete`, hiddenFields(confirm));
    const templateId = /href="\/templates\/([\w-]+)"/.exec(await page(ben, "/"))?.[1] ?? "";
    // The admin turns the rule on; Ben's device has no account.
    test.planDeps.publicRequiresLogin = true;
    // The template stays public when edited, like a plan (I58).
    const editPage = await page(ben, `/templates/${templateId}/edit`);
    expect(editPage).toContain(`${PUBLIC_RADIO} checked=""`);
    expect(editPage).not.toContain(`${PUBLIC_RADIO} checked="" disabled`);
    const fields = hiddenFields(await page(ben, `/templates/${templateId}`));
    const repeated = await ben.postForm(`/templates/${templateId}/repeat`, {
      ...fields,
      date: "2026-07-05",
      time: "08:00",
    });
    const html = await repeated.text();
    expect(html).toContain(escaped(en("template.adjustedVisibility")));
    const newPlan = /https:\/\/runs\.example\.org\/p\/([\w-]{22})/.exec(html)?.[1] ?? "";
    expect(await page(ben, `/p/${newPlan}`)).not.toContain(LABEL);
  });
});

describe("exports (spec 3.7)", () => {
  it("say who could find the plan", async () => {
    const { app } = await createTestApp({ env: { PUBLIC_REQUIRES_LOGIN: "false" } });
    const ben = new TestClient(app);
    const { planId } = await createPlanViaUi(ben, { visibility: "public" });
    const files = unzipSync(
      new Uint8Array(await (await ben.get(`/p/${planId}/host/export.zip`)).arrayBuffer()),
    );
    const data = JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array())) as {
      plans: { plan: { visibility: string } }[];
    };
    expect(data.plans[0]?.plan.visibility).toBe("public");
  });
});

describe("privacy notice", () => {
  it("says what a public plan shows, where plans can be public", async () => {
    const text = (html: string) => html.replaceAll("&#39;", "'");
    const withLogin = await setup();
    expect(text(await (await withLogin.app.request("/privacy")).text())).toContain(
      en("privacy.publicPlans"),
    );
    const without = await createTestApp();
    expect(text(await (await without.app.request("/privacy")).text())).not.toContain(
      en("privacy.publicPlans"),
    );
  });
});
