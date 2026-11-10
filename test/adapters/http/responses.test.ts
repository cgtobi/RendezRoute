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

describe("plan page response form (spec 5 feature 5, 3.4)", () => {
  it("offers viewers Interested and I'm in, with the open-mode note", async () => {
    const { planId, newClient } = await setup();
    const html = await (await newClient().get(`/p/${planId}`)).text();
    const hidden = hiddenFields(html);
    expect(hidden._csrf).toBeDefined();
    expect(hidden.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(html).toContain('name="displayName"');
    expect(html).toContain('name="choice" value="interested"');
    expect(html).toContain('name="choice" value="joined"');
    expect(html).toContain(escaped(en["respond.openModeNote"]));
  });

  it("shows counts and no response form to the host", async () => {
    const { host, planId, newClient } = await setup();
    await respondViaUi(newClient(), planId, "Ben", "joined");
    await respondViaUi(newClient(), planId, "Cleo", "interested");
    const html = await (await host.get(`/p/${planId}`)).text();
    expect(html).toContain(
      escaped(en["plan.counts"].replace("{participants}", "1").replace("{interested}", "1")),
    );
    expect(html).not.toContain('name="displayName"');
  });
});

describe("POST /p/:id/respond", () => {
  it("shows the manage link once, with no-store and no-referrer, and links the device", async () => {
    const { planId, newClient } = await setup();
    const ben = newClient();
    const { response, managePath } = await respondViaUi(ben, planId, "Ben", "joined");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(managePath).toMatch(/^\/m\/[A-Za-z0-9_-]{43}$/);
    expect(ben.cookies.has("__Host-rr-device")).toBe(true);
  });

  it("gives joined people the exact start and participant list with the host badge", async () => {
    const { planId, newClient } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");
    const html = await (await ben.get(`/p/${planId}`)).text();
    expect(html).toContain("North gate, by the bike racks");
    // The host's mark after the name: an icon, and the word for screen readers (decision D30).
    expect(html).toMatch(
      /Anna<\/span><span class="host-mark"><span class="icon icon-flag" aria-hidden="true"><\/span><span class="visually-hidden">host<\/span>/,
    );
    expect(html).toContain("Ben");
  });

  it("gives interested people their status but not the exact start; the host sees them listed", async () => {
    const { host, planId, newClient } = await setup();
    const cleo = newClient();
    await respondViaUi(cleo, planId, "Cleo", "interested");
    const html = await (await cleo.get(`/p/${planId}`)).text();
    expect(html).toContain(escaped(en["status.interested"]));
    expect(html).not.toContain("North gate");
    expect(await (await host.get(`/p/${planId}`)).text()).toContain("Cleo");
  });

  it("re-renders the plan page with the error and the entered name", async () => {
    const { planId, newClient } = await setup();
    const client = newClient();
    const { response, html } = await respondViaUi(client, planId, "ANNA", "joined");
    expect(response.status).toBe(422);
    expect(html).toContain(escaped(en["field.name_taken_by_host"]));
    expect(html).toContain('value="ANNA"');
    expect(client.cookies.has("__Host-rr-device")).toBe(false);
  });

  it("sends a device that already responded to its manage page, and the host to the plan", async () => {
    const { host, planId, newClient } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");
    // After responding, the plan page shows no form; a second submit (e.g. from an old tab) carries its own token.
    const again = await ben.postForm(`/p/${planId}/respond`, {
      _csrf: (await ben.hiddenFields("/new"))._csrf ?? "",
      nonce: "nonce-bbbbbbbbbbbbbbbb",
      displayName: "Ben",
      choice: "interested",
    });
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe(`/p/${planId}/me`);
    // The host's plan page has no response form, so take the CSRF token from another form.
    const hostTry = await host.postForm(`/p/${planId}/respond`, {
      _csrf: (await host.hiddenFields("/new"))._csrf ?? "",
      nonce: "nonce-hhhhhhhhhhhhhhhh",
      displayName: "Someone",
      choice: "joined",
    });
    expect(hostTry.status).toBe(303);
    expect(hostTry.headers.get("location")).toBe(`/p/${planId}`);
  });

  it("refuses a removed person on the same device (spec 3.5)", async () => {
    const { database, planId, newClient } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");
    database.sqlite
      .prepare("update responses set kind = 'removed', previous_kind = 'joined'")
      .run();
    const html = await (await ben.get(`/p/${planId}`)).text();
    expect(html).toContain(escaped(en["status.removed"]));
    expect(html).not.toContain("North gate");
    database.sqlite.prepare("delete from device_links where role = 'manage'").run();
    const again = await respondViaUi(ben, planId, "Ben", "joined");
    expect(again.response.status).toBe(403);
  });

  it("closes at the start time (spec 3.1)", async () => {
    const { clock, planId, newClient } = await setup();
    const client = newClient();
    const hidden = await client.hiddenFields(`/p/${planId}`);
    clock.set("2026-06-07T05:30:00Z");
    const html = await (await client.get(`/p/${planId}`)).text();
    expect(html).not.toContain('name="displayName"');
    expect(html).toContain(escaped(en["respond.closed"]));
    const late = await client.postForm(`/p/${planId}/respond`, {
      ...hidden,
      displayName: "Late",
      choice: "joined",
    });
    expect(late.status).toBe(409);
    expect(await late.text()).toContain(`href="/p/${planId}"`);
  });

  it("requires a CSRF token (spec 3.8)", async () => {
    const { planId, newClient } = await setup();
    const response = await newClient().postForm(`/p/${planId}/respond`, {
      nonce: "nonce-aaaaaaaaaaaaaaaa",
      displayName: "Ben",
      choice: "joined",
    });
    expect(response.status).toBe(403);
  });
});

describe("manage page /p/:id/me (spec 5 feature 6)", () => {
  it("changes the response and name, then withdraws with a hard delete", async () => {
    const { planId, newClient, database } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");

    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).toContain('value="Ben"');
    const hidden = hiddenFields(page);
    const updated = await ben.postForm(`/p/${planId}/me`, {
      ...hidden,
      displayName: "Benjamin",
      choice: "interested",
    });
    expect(updated.status).toBe(303);
    expect(updated.headers.get("location")).toBe(`/p/${planId}/me`);
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain('value="Benjamin"');

    const withdrawn = await ben.postForm(`/p/${planId}/me/withdraw`, hidden);
    expect(withdrawn.status).toBe(303);
    expect(withdrawn.headers.get("location")).toBe(`/p/${planId}`);
    expect(
      (database.sqlite.prepare("select count(*) as n from responses").get() as { n: number }).n,
    ).toBe(0);
    const after = await ben.get(`/p/${planId}/me`);
    expect(after.status).toBe(303);
    expect(after.headers.get("location")).toBe(`/p/${planId}`);
  });

  it("redirects devices without a response to the plan", async () => {
    const { planId, newClient } = await setup();
    const response = await newClient().get(`/p/${planId}/me`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/p/${planId}`);
  });

  it("re-renders with errors for invalid names", async () => {
    const { planId, newClient } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");
    const hidden = await ben.hiddenFields(`/p/${planId}/me`);
    const response = await ben.postForm(`/p/${planId}/me`, {
      ...hidden,
      displayName: "",
      choice: "joined",
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(escaped(en["field.required"]));
  });
});

describe("manage link (spec 3.2, decision D1)", () => {
  it("asks for confirmation on a new device, then links it and redirects to the manage page", async () => {
    const { planId, newClient } = await setup();
    const { managePath } = await respondViaUi(newClient(), planId, "Ben", "joined");
    const other = newClient();
    const confirm = await other.get(managePath ?? "");
    expect(confirm.status).toBe(200);
    expect(confirm.headers.get("referrer-policy")).toBe("no-referrer");
    expect(confirm.headers.get("cache-control")).toBe("no-store");
    expect(confirm.headers.get("x-robots-tag")).toBe("noindex");
    expect(other.cookies.has("__Host-rr-device")).toBe(false);

    const linked = await other.postForm("/m", hiddenFields(await confirm.text()));
    expect(linked.status).toBe(303);
    expect(linked.headers.get("location")).toBe(`/p/${planId}/me`);
    expect((await other.get(`/p/${planId}/me`)).status).toBe(200);

    const again = await other.get(managePath ?? "");
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe(`/p/${planId}/me`);
  });

  it("rejects unknown tokens", async () => {
    const { newClient } = await setup();
    expect((await newClient().get(`/m/${"x".repeat(43)}`)).status).toBe(404);
  });
});

describe("join confirmation (spec 3.10: the deletion date is visible)", () => {
  it("shows when the plan and the response will be deleted", async () => {
    const test = await createTestApp();
    const { planId } = await createPlanViaUi(new TestClient(test.app));
    const { html } = await respondViaUi(new TestClient(test.app), planId, "Ben", "joined");
    // The sample plan starts 2026-06-07 in Berlin and is kept 14 days.
    expect(html).toContain("This plan will be deleted on 21 June 2026.");
  });
});
