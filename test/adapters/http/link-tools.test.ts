// "Get a new link" and "Sign out all other devices" through the web pages (spec 3.2, decision I44).
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const linkIn = (html: string, kind: "a" | "m" | "t") =>
  new RegExp(`https://runs\\.example\\.org(/${kind}/[\\w-]{43})`).exec(html)?.[1] ?? "";

/** Confirms a secret link on a fresh device. */
async function linkedDevice(app: ConstructorParameters<typeof TestClient>[0], path: string) {
  const client = new TestClient(app);
  const confirm = await (await client.get(path)).text();
  await client.postForm(path.slice(0, 2), hiddenFields(confirm));
  return client;
}

describe("the host page's link tools", () => {
  it("issue a new host link once; the old one stops working, linked devices stay", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host);
    const other = await linkedDevice(app, hostPath);
    const page = await (await host.get(`/p/${planId}/host`)).text();
    expect(page).toContain(`action="/p/${planId}/host/link"`);
    expect(page).toContain(`action="/p/${planId}/host/sign-out"`);

    const issued = await host.postForm(`/p/${planId}/host/link`, hiddenFields(page));
    expect(issued.status).toBe(200);
    expect(issued.headers.get("cache-control")).toBe("no-store");
    expect(issued.headers.get("referrer-policy")).toBe("no-referrer");
    const newPath = linkIn(await issued.text(), "a");
    expect(newPath).not.toBe("");
    expect((await new TestClient(app).get(hostPath)).status).toBe(404);
    expect((await new TestClient(app).get(newPath)).status).toBe(200);
    expect((await other.get(`/p/${planId}/host`)).status).toBe(200);

    // Sent again (reload, back button): nothing changes, the link just shown keeps working.
    const again = await host.postForm(`/p/${planId}/host/link`, hiddenFields(page));
    expect(await again.text()).toContain(en("linkTools.alreadyIssued"));
    expect((await new TestClient(app).get(newPath)).status).toBe(200);
  });

  it("sign out other devices and say how many", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host);
    const other = await linkedDevice(app, hostPath);
    const fields = hiddenFields(await (await host.get(`/p/${planId}/host`)).text());
    const signedOut = await host.postForm(`/p/${planId}/host/sign-out`, fields);
    expect(signedOut.headers.get("location")).toBe(`/p/${planId}/host?signedOut=1`);
    expect(await (await host.get(`/p/${planId}/host?signedOut=1`)).text()).toContain(
      en("linkTools.signedOut", { count: 1 }),
    );
    expect((await other.get(`/p/${planId}/host`)).headers.get("location")).toBe(`/p/${planId}`);
  });

  it("are refused to other devices", async () => {
    const { app } = await createTestApp();
    const { planId } = await createPlanViaUi(new TestClient(app));
    const stranger = new TestClient(app);
    const csrf = hiddenFields(await (await stranger.get(`/p/${planId}`)).text())._csrf ?? "";
    for (const action of ["link", "sign-out"]) {
      const refused = await stranger.postForm(`/p/${planId}/host/${action}`, { _csrf: csrf });
      expect(refused.headers.get("location")).toBe(`/p/${planId}`);
    }
  });
});

describe("the manage and template pages' link tools", () => {
  it("issue a new manage link", async () => {
    const { app } = await createTestApp();
    const { planId } = await createPlanViaUi(new TestClient(app));
    const ben = new TestClient(app);
    const { managePath = "" } = await respondViaUi(ben, planId, "Ben", "joined");
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).toContain(`action="/p/${planId}/me/link"`);
    const issued = await ben.postForm(`/p/${planId}/me/link`, hiddenFields(page));
    const newPath = linkIn(await issued.text(), "m");
    expect(newPath).not.toBe("");
    expect((await new TestClient(app).get(managePath)).status).toBe(404);
    expect((await new TestClient(app).get(newPath)).status).toBe(200);
  });

  it("sign out other devices from a response, and promise notifications only to those who may have them", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host);
    const ben = new TestClient(app);
    const { managePath = "" } = await respondViaUi(ben, planId, "Ben", "joined");
    const other = await linkedDevice(app, managePath);
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).toContain(en("linkTools.signOutNotifications"));
    const signedOut = await ben.postForm(`/p/${planId}/me/sign-out`, hiddenFields(page));
    expect(signedOut.headers.get("location")).toBe(`/p/${planId}/me?signedOut=1`);
    expect((await other.get(`/p/${planId}/me`)).headers.get("location")).toBe(`/p/${planId}`);

    const hostPage = await (await host.get(`/p/${planId}/host`)).text();
    const responseId = /people\/([\w-]+)\/remove/.exec(hostPage)?.[1] ?? "";
    await host.postForm(`/p/${planId}/host/people/${responseId}/remove`, hiddenFields(hostPage));
    const removed = await (await ben.get(`/p/${planId}/me`)).text();
    expect(removed).toContain(`action="/p/${planId}/me/sign-out"`);
    expect(removed).not.toContain(en("linkTools.signOutNotifications"));
  });

  it("give a template kept at deletion a link, and keep strangers out", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host, { keepAsTemplate: "1" });
    const confirm = await (await host.get(`/p/${planId}/host/delete`)).text();
    await host.postForm(`/p/${planId}/host/delete`, hiddenFields(confirm));
    const templateId = /href="\/templates\/([\w-]+)"/.exec(await (await host.get("/")).text())?.[1];
    const page = await (await host.get(`/templates/${templateId}`)).text();
    expect(page).toContain(`action="/templates/${templateId}/link"`);
    expect(page).not.toContain(en("linkTools.signOutNotifications"));

    const issued = await host.postForm(`/templates/${templateId}/link`, hiddenFields(page));
    const other = await linkedDevice(app, linkIn(await issued.text(), "t"));
    expect((await other.get(`/templates/${templateId}`)).status).toBe(200);

    const signedOut = await other.postForm(
      `/templates/${templateId}/sign-out`,
      hiddenFields(await (await other.get(`/templates/${templateId}`)).text()),
    );
    expect(signedOut.headers.get("location")).toBe(`/templates/${templateId}?signedOut=1`);
    expect((await host.get(`/templates/${templateId}`)).status).toBe(404);

    const stranger = new TestClient(app);
    const csrf = hiddenFields(await (await stranger.get("/new")).text())._csrf ?? "";
    expect((await stranger.postForm(`/templates/${templateId}/link`, { _csrf: csrf })).status).toBe(
      404,
    );
  });
});
