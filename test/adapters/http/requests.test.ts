// Joining on approval through the web pages (spec 3.4, 3.5, 6 feature 1).
import { describe, expect, it } from "vite-plus/test";
import { en } from "../../../src/adapters/i18n/messages/en.ts";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, planForm } from "../../support/plans.ts";

const t = translator("en");
const NOTE = "SENTINEL-note: I run 5:30 & like hills";
const EXACT = "North gate, by the bike racks";

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host, { joinMode: "approval" });
  return { ...test, host, planId, newClient: () => new TestClient(test.app) };
}

async function requestToJoin(client: TestClient, planId: string, name: string, note = NOTE) {
  const hidden = await client.hiddenFields(`/p/${planId}`);
  return client.postForm(`/p/${planId}/respond`, {
    ...hidden,
    displayName: name,
    choice: "requested",
    requestNote: note,
  });
}

/** Posts one of the host page's person buttons (accept, reject, remove, restore). */
async function hostAction(host: TestClient, planId: string, action: string) {
  const page = await (await host.get(`/p/${planId}/host`)).text();
  const form = new RegExp(
    `<form[^>]*action="(/p/${planId}/host/people/[^"]+/${action})"[\\s\\S]*?</form>`,
  ).exec(page);
  if (form?.[1] === undefined) throw new Error(`no ${action} button`);
  return host.postForm(form[1], hiddenFields(form[0]));
}

describe("the create form (spec 3.4)", () => {
  it("offers both join modes, open by default", async () => {
    const test = await createTestApp();
    const html = await (await new TestClient(test.app).get("/new")).text();
    expect(html).toMatch(/<input type="radio" name="joinMode" value="open" checked=""/);
    expect(html).toContain('name="joinMode" value="approval"');
    expect(html).toContain(escaped(en["form.joinModeHint"]));
  });
});

describe("requesting to join (spec 6 feature 1)", () => {
  it("replaces I'm in with Request to join and an optional note to the host", async () => {
    const { planId, newClient } = await setup();
    const page = await (await newClient().get(`/p/${planId}`)).text();
    expect(page).toContain(
      `<button type="submit" name="choice" value="requested">${t("respond.request")}</button>`,
    );
    expect(page).not.toContain('value="joined"');
    expect(page).toMatch(/<textarea[^>]*name="requestNote"/);
    expect(page).toContain(escaped(t("respond.approvalNote")));
  });

  it("shows the request to the host with its note, and the note to nobody else", async () => {
    const { host, planId, newClient } = await setup();
    const ben = newClient();
    expect((await requestToJoin(ben, planId, "Ben")).status).toBe(200);
    const hostPage = await (await host.get(`/p/${planId}/host`)).text();
    expect(hostPage).toContain("Ben");
    expect(hostPage).toContain(escaped(NOTE));
    // Accept and Reject in the page's one button row, so they stack evenly on phones (design note).
    expect(hostPage).toMatch(/<div class="button-row"><form method="post" action="[^"]+\/accept">/);
    expect(await (await host.get(`/p/${planId}`)).text()).toContain(
      escaped(t("plan.pendingRequests", { count: 1 })),
    );
    for (const path of [`/p/${planId}`, `/p/${planId}/me`]) {
      expect(await (await ben.get(path)).text()).not.toContain("SENTINEL-note");
      expect(await (await newClient().get(path)).text()).not.toContain("SENTINEL-note");
    }
  });

  it("Pending and rejected requesters never receive exact location, route or contributions", async () => {
    const { host, planId, newClient } = await setup();
    const pending = newClient();
    const rejected = newClient();
    // The host page lists requests in order; the first one is rejected.
    await requestToJoin(rejected, planId, "Rex");
    await requestToJoin(pending, planId, "Ben");
    await hostAction(host, planId, "reject");
    for (const client of [pending, rejected]) {
      for (const path of ["", "/me", "/route.gpx", "/route.geojson", "/og.png"]) {
        const body = await (await client.get(`/p/${planId}${path}`)).text();
        expect({ path, leaks: body.includes(EXACT) || body.includes("48.16321") }).toEqual({
          path,
          leaks: false,
        });
      }
    }
    expect(await (await rejected.get(`/p/${planId}/me`)).text()).toContain(
      escaped(t("status.rejected")),
    );
    expect(await (await pending.get(`/p/${planId}/me`)).text()).toContain(
      escaped(t("status.requested")),
    );
  });

  it("once accepted, shows the participant the exact start", async () => {
    const { host, planId, newClient } = await setup();
    const ben = newClient();
    await requestToJoin(ben, planId, "Ben");
    expect((await hostAction(host, planId, "accept")).status).toBe(303);
    expect(await (await ben.get(`/p/${planId}`)).text()).toContain(EXACT);
  });

  it("once rejected, cannot be sent again from that device", async () => {
    const { host, planId, newClient } = await setup();
    const rex = newClient();
    await requestToJoin(rex, planId, "Rex");
    await hostAction(host, planId, "reject");
    const page = await (await rex.get(`/p/${planId}`)).text();
    expect(page).not.toContain('name="requestNote"');
    const hostPage = await (await host.get(`/p/${planId}/host`)).text();
    expect(hostPage).toContain(escaped(t("host.rejected")));
    expect(hostPage).toContain(escaped(t("host.undoReject")));
  });
});

describe("switching to open mode (spec 3.4)", () => {
  it("asks how many pending requests will be accepted, then accepts them", async () => {
    const { host, planId, newClient } = await setup();
    await requestToJoin(newClient(), planId, "Ben");
    await requestToJoin(newClient(), planId, "Ida");
    const form = await (await host.get(`/p/${planId}/host`)).text();
    const fields = { ...hiddenFields(form), ...planForm({ joinMode: "open" }) };
    const ask = await host.postForm(`/p/${planId}/host`, fields);
    const confirm = await ask.text();
    expect(confirm).toContain(escaped(t("host.acceptPendingWarning", { count: 2 })));
    // The confirmation re-shows the form with a hidden confirmation field; the browser posts it all.
    const saved = await host.postForm(`/p/${planId}/host`, { ...fields, ...hiddenFields(confirm) });
    expect(hiddenFields(confirm)).toMatchObject({ confirmAcceptPending: "2" });
    expect(saved.status).toBe(303);
    const page = await (await host.get(`/p/${planId}`)).text();
    expect(page).toContain(escaped(t("plan.counts", { participants: 2, interested: 0 })));
  });
});

describe("the manage page in approval mode (spec 3.4)", () => {
  it("offers interested and requesting, not joining directly", async () => {
    const { planId, newClient } = await setup();
    const ben = newClient();
    await requestToJoin(ben, planId, "Ben");
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).toContain('name="choice" value="interested"');
    expect(page).toContain('name="choice" value="requested"');
    expect(page).not.toContain('name="choice" value="joined"');
  });
});

describe("after the start (spec 3.1)", () => {
  it("shows the host no Accept or Reject and the requester 'not answered'", async () => {
    const { host, planId, newClient, clock } = await setup();
    const ben = newClient();
    await requestToJoin(ben, planId, "Ben");
    clock.set("2026-06-07T06:00:00Z");
    const hostPage = await (await host.get(`/p/${planId}/host`)).text();
    expect(hostPage).toContain("Ben");
    expect(hostPage).not.toMatch(/\/host\/people\/[^"]+\/accept/);
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(
      escaped(t("status.notAnswered")),
    );
    expect(await (await ben.get(`/p/${planId}`)).text()).toContain(
      escaped(t("status.notAnswered")),
    );
  });
});

describe("the host's pending-requests notice", () => {
  it("is its own paragraph, not nested in another", async () => {
    const { host, planId, newClient } = await setup();
    await requestToJoin(newClient(), planId, "Ben");
    const page = await (await host.get(`/p/${planId}`)).text();
    expect(page).not.toMatch(/<p[^>]*>(?:(?!<\/p>)[\s\S])*<p/);
  });
});
