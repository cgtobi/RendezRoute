// Guard: no admin page renders a map. Map assets are public-site only (MapAssets is always called
// with pathBase "/"). If an admin page ever gets a map, pathBase must come from adminRoot (the admin
// is served under a path prefix behind Home Assistant Ingress) and the absolute geocode and route
// URLs must become prefix-aware first; then update this test deliberately.
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanWithRouteViaUi } from "../../support/plans.ts";
import { sampleGpx } from "../../support/gpx.ts";

const TOKEN = "admin-token-for-tests-0123456789abcdef";
const FORBIDDEN = ["build/map.js", "build/map.css", "data-tile-url"];

function expectNoMap(html: string, where: string) {
  for (const needle of FORBIDDEN) {
    expect(html.includes(needle), `${where} must not contain ${needle}`).toBe(false);
  }
}

describe("admin pages render no map", () => {
  it("keeps the admin plan page, home and invite page free of map assets", async () => {
    const test = await createTestApp({
      env: { ADMIN_TOKEN: TOKEN, POSTING_MODE: "invite" },
    });
    const admin = new TestClient(test.app);
    const login = hiddenFields(await (await admin.get("/admin/login")).text());
    expect((await admin.postForm("/admin/login", { ...login, token: TOKEN })).status).toBe(303);

    // Invite mode: the host creates the plan through an invite link.
    const home = await (await admin.get("/admin/")).text();
    const fields = hiddenFields(home.slice(home.indexOf('id="invites"')));
    const created = await admin.postForm("/admin/invites", {
      ...fields,
      expiresOn: "",
      maxUses: "",
    });
    const invitePage = await created.text();
    const invitePath = /\/i\/[A-Za-z0-9_-]{43}/.exec(invitePage)?.[0];
    expect(created.status).toBe(200);
    expect(invitePath).toBeDefined();

    const host = new TestClient(test.app);
    const opened = await host.get(invitePath ?? "");
    await host.postForm("/i", hiddenFields(await opened.text()));
    const { planId, html: planCreated } = await createPlanWithRouteViaUi(host, {}, sampleGpx());
    // Sanity: the public plan page does show the map, so the guard can fail.
    const publicPlan = await (await new TestClient(test.app).get(`/p/${planId}`)).text();
    expect(publicPlan).toContain("data-tile-url");
    expect(planCreated.length).toBeGreaterThan(0);

    for (const path of ["/admin/", `/admin/plans/${planId}`]) {
      const response = await admin.get(path);
      expect(`${path} ${response.status}`).toBe(`${path} 200`);
      expectNoMap(await response.text(), path);
    }
    expectNoMap(invitePage, "invite page");
  });

  it("keeps the Ingress admin home free of map assets", async () => {
    const test = await createTestApp({
      env: {
        ADMIN_INGRESS: "true",
        ADMIN_PORT: "3001",
        ADMIN_BIND: "0.0.0.0",
        ADMIN_INGRESS_SKIP_VERSION_CHECK: "true",
      },
    });
    const adminApp = test.adminApp;
    if (adminApp === undefined) throw new Error("no admin app");
    const response = await adminApp.request(
      "/admin/",
      {
        redirect: "manual",
        headers: {
          "x-remote-user-groups": "system-users,system-admin",
          "x-remote-user-id": "user-a",
        },
      },
      { incoming: { socket: { remoteAddress: "172.30.32.2" } } },
    );
    expect(response.status).toBe(200);
    expectNoMap(await response.text(), "Ingress admin home");
  });
});
