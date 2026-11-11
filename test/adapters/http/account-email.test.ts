// The account's address, lending it to a plan, and "Email me my links" through the pages (spec 7
// Optional notification channels; decisions D31, I52; plan v1.0 step 6b).
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";
import { FakeOidcServer } from "../../fakes/oidc-server.ts";

const en = translator("en");
const SMTP = { SMTP_HOST: "mail.example.org", SMTP_FROM: "runs@example.org" };

async function setup(env: Record<string, string> = SMTP) {
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

/** The link in the last email sent to this address. */
function lastLink(mailer: { sent: { to: string; text: string }[] }, to: string): string {
  const mail = mailer.sent.filter((sent) => sent.to === to).at(-1);
  const url = /https:\/\/runs\.example\.org(\/[a-z]\/[^\s]+)/.exec(mail?.text ?? "")?.[1];
  if (url === undefined) throw new Error(`no link mailed to ${to}`);
  return url;
}

async function post(client: TestClient, page: string, action: string, fields = {}) {
  const hidden = await client.hiddenFields(page);
  return client.postForm(action, { _csrf: hidden._csrf ?? "", ...fields });
}

/** Sets the account's address and confirms it through the emailed link. */
async function confirmedAccountAddress(
  test: Awaited<ReturnType<typeof setup>>,
  client: TestClient,
) {
  await post(client, "/account", "/account/email", { address: "anna@example.org" });
  await test.runJobs();
  const link = lastLink(test.mailer, "anna@example.org");
  await client.postForm("/e", { ...(await client.hiddenFields(link)), action: "confirm" });
}

describe("the account's address (decision D31)", () => {
  it("is set and confirmed on the account page", async () => {
    const test = await setup();
    const anna = new TestClient(test.app);
    await logIn(anna, test.oidc);
    const page = await (await anna.get("/account")).text();
    expect(page).toContain(escaped(en("email.accountHint")));
    await confirmedAccountAddress(test, anna);
    expect(test.mailer.sent[0]?.subject).toBe("Confirm emails about your account on RendezRoute");
    expect(await (await anna.get("/account")).text()).toContain(
      escaped(en("email.accountOn", { address: "anna@example.org" })),
    );
    // In the account export (spec 3.7).
    const files = unzipSync(
      new Uint8Array(await (await anna.get("/account/export.zip")).arrayBuffer()),
    );
    expect(JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array())).account).toMatchObject({
      notificationEmail: { address: "anna@example.org", confirmed: true },
    });
  });

  it("is offered for the account's plans in one click, without a second confirmation", async () => {
    const test = await setup();
    const anna = new TestClient(test.app);
    await logIn(anna, test.oidc);
    await confirmedAccountAddress(test, anna);
    const { planId } = await createPlanViaUi(anna);
    const host = await (await anna.get(`/p/${planId}/host`)).text();
    expect(host).toContain(escaped(en("email.useAccount", { address: "anna@example.org" })));
    // Co-hosts see the plan's address too (I55).
    expect(host).toContain(escaped(en("email.hostShared")));
    expect(await (await anna.get("/account")).text()).not.toContain(
      escaped(en("email.hostShared")),
    );
    const sent = test.mailer.sent.length;
    const used = await post(anna, `/p/${planId}/host`, `/p/${planId}/host/email/account`);
    expect(used.headers.get("location")).toBe(`/p/${planId}/host`);
    expect(await (await anna.get(`/p/${planId}/host`)).text()).toContain(
      escaped(en("email.on", { address: "anna@example.org" })),
    );
    await test.runJobs();
    expect(test.mailer.sent).toHaveLength(sent);
  });
});

describe("Email me my links (decision D31)", () => {
  it("emails a new link and the old one stops working", async () => {
    const test = await setup();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    const ben = new TestClient(test.app);
    const { managePath } = await respondViaUi(ben, planId, "Ben", "joined");
    // No confirmed address yet: no button.
    expect(await (await ben.get(`/p/${planId}/me`)).text()).not.toContain("/me/link/email");

    await post(ben, `/p/${planId}/me`, `/p/${planId}/me/email`, { address: "ben@example.org" });
    await test.runJobs();
    const confirm = lastLink(test.mailer, "ben@example.org");
    await ben.postForm("/e", { ...(await ben.hiddenFields(confirm)), action: "confirm" });
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).toContain(escaped(en("linkTools.emailLinkHint", { address: "ben@example.org" })));

    const sent = await ben.postForm(`/p/${planId}/me/link/email`, hiddenFields(page));
    expect(sent.status).toBe(303);
    expect(sent.headers.get("location")).toBe(`/p/${planId}/me?linkEmailed=sent`);
    expect(await (await ben.get(`/p/${planId}/me?linkEmailed=sent`)).text()).toContain(
      escaped(en("linkTools.emailed", { address: "ben@example.org" })),
    );
    const emailed = lastLink(test.mailer, "ben@example.org");
    expect(emailed).toMatch(/^\/m\/[A-Za-z0-9_-]{43}$/);
    // The old link no longer works, the emailed one does (spec 3.2).
    const stranger = new TestClient(test.app);
    expect((await stranger.get(managePath ?? "")).status).toBe(404);
    expect((await stranger.get(emailed)).status).toBe(200);
  });

  it("is limited per address, whoever holds the link (spec 3.11)", async () => {
    const test = await setup();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    await post(host, `/p/${planId}/host`, `/p/${planId}/host/email`, {
      address: "anna@example.org",
    });
    await test.runJobs();
    const confirm = lastLink(test.mailer, "anna@example.org");
    await host.postForm("/e", { ...(await host.hiddenFields(confirm)), action: "confirm" });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const page = await (await host.get(`/p/${planId}/host`)).text();
      statuses.push(
        (await host.postForm(`/p/${planId}/host/link/email`, hiddenFields(page))).status,
      );
    }
    // The confirmation used one of the address's three; two links, then the limit.
    expect(statuses).toEqual([303, 303, 429]);
  });

  it("keeps the old link when the email could not be sent", async () => {
    const test = await setup();
    const host = new TestClient(test.app);
    const { planId, hostPath } = await createPlanViaUi(host);
    await post(host, `/p/${planId}/host`, `/p/${planId}/host/email`, {
      address: "anna@example.org",
    });
    await test.runJobs();
    const confirm = lastLink(test.mailer, "anna@example.org");
    await host.postForm("/e", { ...(await host.hiddenFields(confirm)), action: "confirm" });
    test.mailer.result = "retry";
    const page = await (await host.get(`/p/${planId}/host`)).text();
    const failed = await host.postForm(`/p/${planId}/host/link/email`, hiddenFields(page));
    expect(failed.headers.get("location")).toBe(`/p/${planId}/host?linkEmailed=failed`);
    expect(await (await host.get(`/p/${planId}/host?linkEmailed=failed`)).text()).toContain(
      escaped(en("linkTools.emailFailed")),
    );
    expect(
      test.mailer.sent.filter((mail) => mail.subject.startsWith("Your new link")),
    ).toHaveLength(1);
    // Nothing changed: the old host link still works.
    expect((await new TestClient(test.app).get(hostPath)).status).toBe(200);
  });
});

describe("privacy notice", () => {
  it("explains the account's address when email and logins are configured", async () => {
    const withAccounts = await setup();
    const html = await (await withAccounts.app.request("/privacy")).text();
    expect(html.replaceAll("&#39;", "'")).toContain(en("privacy.accountEmail"));
    const without = await createTestApp({ env: SMTP });
    expect(
      (await (await without.app.request("/privacy")).text()).replaceAll("&#39;", "'"),
    ).not.toContain(en("privacy.accountEmail"));
  });
});
