// The home page lists the visitor's own plans (hosted, joined, interested, requested), and
// nothing else: no exact start, names, notes, area or route.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { sampleGpx } from "../../support/gpx.ts";
import { FakeOidcServer, type FakeOidcUser } from "../../fakes/oidc-server.ts";
import { createPlanViaUi, createPlanWithRouteViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");

async function setup() {
  const test = await createTestApp({ env: {} });
  return { ...test, client: () => new TestClient(test.app) };
}

function expectNothingPrivate(html: string) {
  expect(html).not.toContain("North gate");
  expect(html).not.toContain("48.16321");
  expect(html).not.toContain("11.60147");
  expect(html).not.toContain("47.12345");
  expect(html).not.toContain("10.98765");
  expect(html).not.toContain("route.gpx");
  expect(html).not.toContain("Bring water");
  expect(html).not.toContain("Englischer Garten");
  expect(html).not.toContain("Benedikta Quill");
  expect(html).not.toContain("Anna");
}

describe("the home page's own plans", () => {
  it("shows the host their plan, and a joiner theirs, each with the right link", async () => {
    const { client } = await setup();
    const anna = client();
    const { planId, hostPath } = await createPlanWithRouteViaUi(
      anna,
      { title: "Hill repeats" },
      sampleGpx(),
    );
    const ben = client();
    const joined = await respondViaUi(ben, planId, "Benedikta Quill", "joined");
    expect(joined.managePath).toBeDefined();

    const hostHome = await anna.get("/");
    expect(hostHome.headers.get("cache-control")).toBe("private, no-store");
    const hostHtml = await hostHome.text();
    expect(hostHtml).toContain(en("home.upcoming"));
    expect(hostHtml).toContain(`href="/p/${planId}"`);
    expect(hostHtml).toContain("Hill repeats");
    expect(hostHtml).toContain(en("home.roleHost"));
    expect(hostHtml).not.toContain(`href="/p/${planId}/me"`);
    expect(hostHtml).not.toContain(`href="/p/${planId}/host"`);
    // The host link token itself is never repeated on the home page.
    expect(hostHtml).not.toContain(hostPath);
    expectNothingPrivate(hostHtml);

    const joinerHome = await ben.get("/");
    expect(joinerHome.headers.get("cache-control")).toBe("private, no-store");
    const joinerHtml = await joinerHome.text();
    expect(joinerHtml).toContain(`href="/p/${planId}"`);
    expect(joinerHtml).not.toContain(`href="/p/${planId}/me"`);
    expect(joinerHtml).not.toContain(`/p/${planId}/host`);
    expect(joinerHtml).toContain("Hill repeats");
    expect(joinerHtml).toContain(escaped(en("status.joined")));
    expectNothingPrivate(joinerHtml);
  });

  it("shows a second device none of them, and a cookie-less first visit nothing", async () => {
    const { client } = await setup();
    const { planId } = await createPlanWithRouteViaUi(
      client(),
      { title: "Hill repeats", visibility: "link" },
      sampleGpx(),
    );
    const other = client();
    await createPlanViaUi(other, { title: "Mine" });
    const otherResponse = await other.get("/");
    expect(otherResponse.headers.get("cache-control")).toBe("private, no-store");
    const otherHtml = await otherResponse.text();
    expect(otherHtml).toContain("Mine");
    expect(otherHtml).not.toContain(planId);
    expect(otherHtml).not.toContain("Hill repeats");

    const first = await client().get("/");
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    const html = await first.text();
    expect(html).not.toContain(en("home.upcoming"));
    expect(html).not.toContain(en("home.recent"));
  });

  it("is private to a browser with a device cookie even when it lists nothing", async () => {
    const { client } = await setup();
    const visitor = client();
    // A cancelled plan is not listed, but the browser has a device.
    const { planId } = await createPlanViaUi(visitor, { title: "Called off" });
    const host = `/p/${planId}/host`;
    await visitor.postForm(`${host}/cancel`, await visitor.hiddenFields(host));
    const response = await visitor.get("/");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain(en("home.upcoming"));
  });

  it("lists a plan that started this week under Recently", async () => {
    const { client, clock } = await setup();
    const anna = client();
    const { planId } = await createPlanWithRouteViaUi(anna, { title: "Just done" }, sampleGpx());
    clock.set("2026-06-08T12:00:00Z");
    const html = await (await anna.get("/")).text();
    expect(html).toContain(en("home.recent"));
    expect(html).not.toContain(en("home.upcoming"));
    expect(html).toContain(`href="/p/${planId}"`);
    expect(html).not.toContain(`/p/${planId}/host`);
    expectNothingPrivate(html);
  });

  it("leaves out a cancelled plan", async () => {
    const { client } = await setup();
    const anna = client();
    const { planId } = await createPlanWithRouteViaUi(anna, { title: "Called off" }, sampleGpx());
    const host = `/p/${planId}/host`;
    await anna.postForm(`${host}/cancel`, await anna.hiddenFields(host));
    const html = await (await anna.get("/")).text();
    expect(html).not.toContain(planId);
    expect(html).not.toContain(en("home.upcoming"));
  });
});

describe("the home page and accounts (spec 7 Identity)", () => {
  const sub = (name: string): FakeOidcUser => ({ sub: `sub-${name}`, name });

  async function logIn(client: TestClient, oidc: FakeOidcServer, user: FakeOidcUser) {
    const started = await client.get("/login/oidc");
    const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), user);
    await client.get(`${callback.pathname}${callback.search}`);
  }

  it("follows the account: a claimed plan shows on every logged-in device, and goes with logout", async () => {
    const oidc = new FakeOidcServer();
    const { app } = await createTestApp({ env: oidc.env(), oidc });
    const phone = new TestClient(app);
    const { planId } = await createPlanViaUi(phone, { title: "Hill repeats" });
    await logIn(phone, oidc, sub("anna"));
    const laptop = new TestClient(app);
    await createPlanViaUi(laptop, { title: "Laptop run" });
    const link = `href="/p/${planId}"`;

    // Not the laptop's before it logs in, and not before it is claimed.
    expect(await (await laptop.get("/")).text()).not.toContain(planId);
    await logIn(laptop, oidc, sub("anna"));
    expect(await (await laptop.get("/")).text()).not.toContain(planId);
    const claimed = await phone.postForm("/account/claim", await phone.hiddenFields("/account"));
    expect(claimed.status).toBe(303);
    const home = await (await laptop.get("/")).text();
    expect(home).toContain(link);
    expect(home).toContain("Hill repeats");
    expect(home).toContain("Laptop run");

    // Another account sees none of it.
    const bob = new TestClient(app);
    await logIn(bob, oidc, sub("bob"));
    expect(await (await bob.get("/")).text()).not.toContain(planId);

    // After logout the laptop loses it, and so does the phone: claiming moved its own link.
    await laptop.postForm("/account/logout", await laptop.hiddenFields("/account"));
    const lapHome = await (await laptop.get("/")).text();
    expect(lapHome).not.toContain(planId);
    expect(lapHome).toContain("Laptop run");
    await phone.postForm("/account/logout", await phone.hiddenFields("/account"));
    expect(await (await phone.get("/")).text()).not.toContain(planId);
  });
});
