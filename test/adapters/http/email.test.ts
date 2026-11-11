// Email notifications through the pages (spec 7 Optional notification channels, decision D31): an
// address on the manage or host page, confirmed by the emailed link, turned off from every email.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const SMTP = { SMTP_HOST: "mail.example.org", SMTP_FROM: "runs@example.org" };
const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";

async function setup(env: Record<string, string> = SMTP) {
  const test = await createTestApp({ env });
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "Ben", "joined");
  return { ...test, host, ben, planId };
}

/** Sends the email form of a manage or host page. */
async function setAddress(client: TestClient, page: string, address: string) {
  const fields = await client.hiddenFields(page);
  return client.postForm(`${page}/email`, { _csrf: fields._csrf ?? "", address });
}

/** The link in the last email sent to this address. */
function lastLink(mailer: { sent: { to: string; text: string }[] }, to: string): string {
  const mail = mailer.sent.filter((sent) => sent.to === to).at(-1);
  const url = /https:\/\/runs\.example\.org(\/e\/[^\s]+)/.exec(mail?.text ?? "")?.[1];
  if (url === undefined) throw new Error(`no link mailed to ${to}`);
  return url;
}

describe("the email setting on the manage and host pages (decision D31)", () => {
  it("is offered only when SMTP is configured", async () => {
    const without = await setup({});
    expect(await (await without.ben.get(`/p/${without.planId}/me`)).text()).not.toContain(
      'name="address"',
    );
    const withSmtp = await setup();
    const page = await (await withSmtp.ben.get(`/p/${withSmtp.planId}/me`)).text();
    expect(page).toContain('name="address"');
    expect(page).toContain(escaped(en("email.hint")));
    // A response's address is its owner's alone; only the host page says others see it.
    expect(page).not.toContain(escaped(en("email.hostShared")));
    expect(await (await withSmtp.host.get(`/p/${withSmtp.planId}/host`)).text()).toContain(
      `action="/p/${withSmtp.planId}/host/email"`,
    );
  });

  it("sends the confirmation link and nothing else until it is used", async () => {
    const { ben, host, planId, mailer, runJobs } = await setup();
    const sent = await setAddress(ben, `/p/${planId}/me`, "ben@example.org");
    expect(sent.status).toBe(303);
    expect(sent.headers.get("location")).toBe(`/p/${planId}/me`);
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(
      escaped(en("email.pending", { address: "ben@example.org" })),
    );
    await runJobs();
    expect(mailer.sent.map((mail) => mail.to)).toEqual(["ben@example.org"]);
    expect(mailer.sent[0]?.subject).toContain("Confirm");

    // The host's change reaches nobody by email before the confirmation.
    await host.postForm(`/p/${planId}/host/cancel`, await host.hiddenFields(`/p/${planId}/host`));
    await runJobs();
    expect(mailer.sent).toHaveLength(1);
  });

  it("confirms on a POST from the link's page, not on opening it", async () => {
    const { app, ben, planId, mailer, runJobs } = await setup();
    await setAddress(ben, `/p/${planId}/me`, "ben@example.org");
    await runJobs();
    const link = lastLink(mailer, "ben@example.org");

    // Opened from the email, in a browser without the device cookie.
    const stranger = new TestClient(app);
    const page = await stranger.get(link);
    expect(page.status).toBe(200);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    const html = await page.text();
    expect(html).toContain(escaped(en("emailLink.confirmHeading")));
    expect(html).toContain("b…@example.org");
    expect(html).not.toContain("ben@example.org");
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(
      escaped(en("email.pending", { address: "ben@example.org" })),
    );

    const confirmed = await stranger.postForm("/e", { ...hiddenFields(html), action: "confirm" });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.text()).toContain(escaped(en("emailLink.confirmed")));
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(
      escaped(en("email.on", { address: "ben@example.org" })),
    );
  });

  it("delivers notifications once confirmed, each with the link to turn them off", async () => {
    const { ben, host, planId, mailer, runJobs } = await setup();
    await setAddress(ben, `/p/${planId}/me`, "ben@example.org");
    await runJobs();
    const link = lastLink(mailer, "ben@example.org");
    await ben.postForm("/e", { ...(await ben.hiddenFields(link)), action: "confirm" });

    await host.postForm(`/p/${planId}/host/cancel`, await host.hiddenFields(`/p/${planId}/host`));
    await runJobs();
    const mail = mailer.sent.at(-1);
    expect(mail?.to).toBe("ben@example.org");
    expect(mail?.text).toContain(en("notify.cancelled"));
    expect(mail?.text).toContain(`https://runs.example.org${link}`);
    expect(mail?.headers["List-Unsubscribe"]).toBe(`<https://runs.example.org${link}>`);
  });

  it("turns off in one click from the mail app, without cookies or a form token (RFC 8058)", async () => {
    const { app, ben, planId, mailer, runJobs } = await setup();
    await setAddress(ben, `/p/${planId}/me`, "ben@example.org");
    await runJobs();
    const link = lastLink(mailer, "ben@example.org");
    await ben.postForm("/e", { ...(await ben.hiddenFields(link)), action: "confirm" });

    const oneClick = (body: string) =>
      app.request(link, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    expect((await oneClick("something=else")).status).toBe(400);
    const off = await oneClick("List-Unsubscribe=One-Click");
    expect(off.status).toBe(200);
    expect(await (await ben.get(`/p/${planId}/me`)).text()).not.toContain(
      escaped(en("email.on", { address: "ben@example.org" })),
    );
    expect((await app.request(link)).status).toBe(404);
  });

  it("turns off from the link's page and from the manage page", async () => {
    const { ben, planId, mailer, runJobs } = await setup();
    await setAddress(ben, `/p/${planId}/me`, "ben@example.org");
    await runJobs();
    const link = lastLink(mailer, "ben@example.org");
    await ben.postForm("/e", { ...(await ben.hiddenFields(link)), action: "confirm" });
    const page = await (await ben.get(link)).text();
    expect(page).toContain(escaped(en("emailLink.offHeading")));
    const off = await ben.postForm("/e", { ...hiddenFields(page), action: "off" });
    expect(await off.text()).toContain(escaped(en("emailLink.turnedOff")));

    await setAddress(ben, `/p/${planId}/me`, "ben@example.org");
    const fields = await ben.hiddenFields(`/p/${planId}/me`);
    const removed = await ben.postForm(`/p/${planId}/me/email/off`, { _csrf: fields._csrf ?? "" });
    expect(removed.status).toBe(303);
    expect(await (await ben.get(`/p/${planId}/me`)).text()).not.toContain(
      escaped(en("email.pending", { address: "ben@example.org" })),
    );
  });

  it("lets whoever got the confirmation refuse it on the link's page", async () => {
    const { app, ben, planId, mailer, runJobs } = await setup();
    await setAddress(ben, `/p/${planId}/me`, "ben@example.org");
    await runJobs();
    const link = lastLink(mailer, "ben@example.org");
    const stranger = new TestClient(app);
    const page = await (await stranger.get(link)).text();
    expect(page).toContain(escaped(en("emailLink.refuse")));
    const refused = await stranger.postForm("/e", { ...hiddenFields(page), action: "off" });
    expect(await refused.text()).toContain(escaped(en("emailLink.turnedOff")));
    expect(await (await ben.get(`/p/${planId}/me`)).text()).not.toContain(
      escaped(en("email.pending", { address: "ben@example.org" })),
    );
  });

  it("keeps a stored address removable when SMTP is switched off", async () => {
    const { app, ben, planId, channels, planDeps, channelLinks } = await setup({});
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).not.toContain('name="address"');
    // An address stored while SMTP was on.
    const [response] = await planDeps.responses.listByPlan(planId);
    const id = await channels.setEmail({ responseId: response?.id ?? "" }, "ben@example.org");
    await channels.confirm(id);
    const later = await (await ben.get(`/p/${planId}/me`)).text();
    expect(later).toContain(escaped(en("email.on", { address: "ben@example.org" })));
    expect(later).toContain(`action="/p/${planId}/me/email/off"`);
    expect(later).not.toContain('name="address"');
    // One still waiting for confirmation can only be turned off too: no new link without SMTP.
    await channels.setEmail({ responseId: response?.id ?? "" }, "benjamin@example.org");
    const waiting = await (await ben.get(`/p/${planId}/me`)).text();
    expect(waiting).toContain(`action="/p/${planId}/me/email/off"`);
    expect(waiting).not.toContain(escaped(en("email.resend")));
    expect(waiting).not.toContain('name="address"');
    // The link in an email sent before still turns them off.
    const pending = (await channels.emailFor({ responseId: response?.id ?? "" }))?.id ?? "";
    const link = await app.request(`/e/${channelLinks.tokenFor(pending)}`);
    expect(link.status).toBe(200);
    expect(await link.text()).toContain(escaped(en("emailLink.offHeading")));
  });

  it("works for the host too", async () => {
    const { host, planId, mailer, runJobs } = await setup();
    const sent = await setAddress(host, `/p/${planId}/host`, "anna@example.org");
    expect(sent.headers.get("location")).toBe(`/p/${planId}/host`);
    await runJobs();
    expect(mailer.sent.map((mail) => mail.to)).toEqual(["anna@example.org"]);
    expect(await (await host.get(`/p/${planId}/host`)).text()).toContain(
      escaped(en("email.pending", { address: "anna@example.org" })),
    );
  });

  it("shows the error and the typed address for anything but one plain address", async () => {
    const { ben, planId, runJobs, mailer } = await setup();
    const response = await setAddress(ben, `/p/${planId}/me`, "ben@example.org, eve@example.org");
    expect(response.status).toBe(422);
    const html = await response.text();
    expect(html).toContain(escaped(en("field.email_invalid")));
    expect(html).toContain('value="ben@example.org, eve@example.org"');
    await runJobs();
    expect(mailer.sent).toEqual([]);
  });

  it("refuses unknown links, and posts without a form token", async () => {
    const { ben, planId, app, mailer, runJobs } = await setup();
    expect((await app.request("/e/made-up_s_token")).status).toBe(404);
    const missing = await ben.postForm(`/p/${planId}/me/email`, { address: "ben@example.org" });
    expect(missing.status).toBe(403);
    // Only the one-click post to the link itself goes without one; the link's page form does not.
    await setAddress(ben, `/p/${planId}/me`, "ben@example.org");
    await runJobs();
    const token = lastLink(mailer, "ben@example.org").slice("/e/".length);
    const forged = await new TestClient(app).postForm("/e", { token, action: "confirm" });
    expect(forged.status).toBe(403);
  });

  it("limits how often a confirmation link is sent to one address (spec 3.11)", async () => {
    const { app, planId, runJobs, mailer } = await setup();
    const statuses: number[] = [];
    // Different people and browsers, all typing the same address.
    for (let attempt = 0; attempt < 4; attempt++) {
      const someone = new TestClient(app);
      await respondViaUi(someone, planId, `Runner ${attempt}`, "joined");
      statuses.push((await setAddress(someone, `/p/${planId}/me`, "victim@example.org")).status);
    }
    expect(statuses).toEqual([303, 303, 303, 429]);
    await runJobs();
    expect(mailer.sent).toHaveLength(3);
  });

  it("never writes an address into the logs", async () => {
    const { ben, planId, logs, runJobs } = await setup();
    await setAddress(ben, `/p/${planId}/me`, "SENTINEL@example.org");
    await setAddress(ben, `/p/${planId}/me`, "SENTINEL, bad");
    await runJobs();
    expect(logs.join("\n")).not.toContain("SENTINEL");
  });
});

describe("exports (spec 3.7: everything attached)", () => {
  it("include the address and whether it is confirmed", async () => {
    const { ben, host, planId, mailer, runJobs } = await setup();
    await setAddress(ben, `/p/${planId}/me`, "ben@example.org");
    await setAddress(host, `/p/${planId}/host`, "anna@example.org");
    await runJobs();
    const link = lastLink(mailer, "anna@example.org");
    await host.postForm("/e", { ...(await host.hiddenFields(link)), action: "confirm" });

    const exported = async (client: TestClient, path: string) => {
      const files = unzipSync(new Uint8Array(await (await client.get(path)).arrayBuffer()));
      return JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array())) as {
        version: number;
        plans: { notificationEmail: unknown }[];
      };
    };
    const response = await exported(ben, `/p/${planId}/me/export.zip`);
    expect(response.version).toBe(7);
    expect(response.plans[0]?.notificationEmail).toEqual({
      address: "ben@example.org",
      confirmed: false,
    });
    expect(
      (await exported(host, `/p/${planId}/host/export.zip`)).plans[0]?.notificationEmail,
    ).toEqual({ address: "anna@example.org", confirmed: true });
    expect((await exported(host, "/my-data/export.zip")).plans[0]?.notificationEmail).toEqual({
      address: "anna@example.org",
      confirmed: true,
    });
  });
});

describe("report alerts (spec 7 Moderation)", () => {
  it("email CONTACT_EMAIL about a new report, without its content", async () => {
    const { host, planId, mailer, runJobs } = await setup({ ...SMTP, ADMIN_TOKEN });
    const form = hiddenFields(await (await host.get(`/p/${planId}/report`)).text());
    await host.postForm(`/p/${planId}/report`, {
      ...form,
      reason: "unsafe",
      details: "SENTINEL-details",
    });
    await runJobs();
    expect(mailer.sent.map((mail) => mail.to)).toEqual(["owner@example.org"]);
    const [alert] = mailer.sent;
    expect(`${alert?.subject}${alert?.text}${alert?.html}`).not.toMatch(/SENTINEL|Sunday/);
    expect(alert?.text).toContain("https://runs.example.org/admin/");
  });
});
