// Posting rules and invite links through the web pages (spec 7 Moderation, decision D1; plan v1.0
// step 3).
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { isSecretLinkPath } from "../../../src/adapters/in/http/routes/secret-links.tsx";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, planForm } from "../../support/plans.ts";

const en = translator("en");
const TOKEN = "admin-token-for-tests-0123456789abcdef";
const INVITE_MODE = { ADMIN_TOKEN: TOKEN, POSTING_MODE: "invite" };
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');
const INVITE_LINK = /https:\/\/runs\.example\.org(\/i\/[A-Za-z0-9_-]{43})/;

async function setup(env: Record<string, string> = INVITE_MODE) {
  const test = await createTestApp({ env });
  const admin = new TestClient(test.app);
  if (env.ADMIN_TOKEN !== undefined) {
    const fields = hiddenFields(await (await admin.get("/admin/login")).text());
    await admin.postForm("/admin/login", { ...fields, token: TOKEN });
  }
  return { ...test, admin };
}

/** Creates an invite on the admin page; returns its path and the page that shows it. */
async function newInvite(
  admin: TestClient,
  choices: { expiresOn?: string; maxUses?: string } = {},
) {
  const home = await (await admin.get("/admin/")).text();
  const action = /<form method="post" action="([^"]*invites)"/.exec(home)?.[1] ?? "";
  expect(action).toBe("../admin/invites");
  const fields = hiddenFields(home.slice(home.indexOf('id="invites"')));
  const created = await admin.postForm("/admin/invites", {
    ...fields,
    expiresOn: choices.expiresOn ?? "",
    maxUses: choices.maxUses ?? "",
  });
  const html = await created.text();
  const path = INVITE_LINK.exec(html)?.[1];
  if (created.status !== 200 || path === undefined) {
    throw new Error(`invite not created: ${created.status} ${html.slice(0, 300)}`);
  }
  return { path, html, created, fields };
}

/** Opens an invite link and confirms it, as a browser would. */
async function useInvite(client: TestClient, path: string) {
  const page = await client.get(path);
  return client.postForm("/i", hiddenFields(await page.text()));
}

const plans = (database: { sqlite: { prepare(sql: string): { pluck(): { get(): unknown } } } }) =>
  database.sqlite.prepare("select count(*) from plans").pluck().get();

describe("POSTING_MODE=anyone (the default)", () => {
  it("has no invite links: anyone creates plans, and the admin page offers none", async () => {
    const { app, admin } = await setup({ ADMIN_TOKEN: TOKEN });
    await createPlanViaUi(new TestClient(app));
    const home = await (await admin.get("/admin/")).text();
    expect(home).not.toContain('id="invites"');
    expect((await new TestClient(app).get(`/i/${"a".repeat(43)}`)).status).toBe(404);
    expect((await admin.postForm("/admin/invites", hiddenFields(home))).status).toBe(404);
  });
});

describe("POSTING_MODE=invite (spec 7 Moderation)", () => {
  it("lets only browsers that confirmed an invite link create plans", async () => {
    const { app, admin, database } = await setup();
    const stranger = new TestClient(app);
    const form = await stranger.get("/new");
    expect(form.status).toBe(200);
    const closed = text(await form.text());
    expect(closed).toContain(en("posting.inviteNeeded"));
    expect(closed).toContain("owner@example.org");
    expect(closed).not.toContain('name="title"');
    // Even with a form from elsewhere.
    const _csrf = hiddenFields(await (await stranger.get("/")).text())._csrf ?? "";
    const forged = await stranger.postForm("/new", {
      _csrf,
      nonce: "n".repeat(22),
      ...planForm(),
    });
    expect(forged.status).toBe(403);
    expect(text(await forged.text())).toContain(en("posting.inviteNeeded"));
    expect(plans(database)).toBe(0);
    expect(stranger.cookies.has("__Host-rr-device")).toBe(false);

    const { path } = await newInvite(admin);
    const invited = new TestClient(app);
    const confirmed = await useInvite(invited, path);
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.get("location")).toBe("/new");
    expect(invited.cookies.has("__Host-rr-device")).toBe(true);
    await createPlanViaUi(invited);
    expect(plans(database)).toBe(1);
  });

  it("opens an invite link without changing anything, behind a private, unindexed page (decision D1)", async () => {
    const { app, admin, database, logs } = await setup();
    const { path } = await newInvite(admin, { maxUses: "1" });
    const visitor = new TestClient(app);
    const opened = await visitor.get(path);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("referrer-policy")).toBe("no-referrer");
    expect(opened.headers.get("x-robots-tag")).toBe("noindex");
    expect(opened.headers.getSetCookie().filter((c) => !c.startsWith("__Host-rr-csrf"))).toEqual(
      [],
    );
    const html = text(await opened.text());
    expect(html).toContain(en("invite.heading"));
    expect(html).toContain('action="/i"');
    // Opened twice, by a link preview and then the person: still one use left.
    await new TestClient(app).get(path);
    expect(database.sqlite.prepare("select uses from invites").pluck().get()).toBe(0);
    expect(database.sqlite.prepare("select count(*) from devices").pluck().get()).toBe(0);
    expect((await useInvite(visitor, path)).status).toBe(303);
    expect(logs.join("\n")).not.toContain(path.slice(3));
  });

  it("leads a device that may already post straight to the form", async () => {
    const { app, admin } = await setup();
    const { path } = await newInvite(admin, { maxUses: "2" });
    const invited = new TestClient(app);
    await useInvite(invited, path);
    const again = await invited.get(path);
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe("/new");
    expect(await (await invited.get("/new")).text()).toContain('name="title"');
    // Coming back used nothing: a second device still gets in.
    expect((await useInvite(new TestClient(app), path)).status).toBe(303);
  });

  it("refuses used-up, expired and revoked invite links", async () => {
    const { app, admin, clock } = await setup();
    const usedUp = await newInvite(admin, { maxUses: "1" });
    await useInvite(new TestClient(app), usedUp.path);
    const expired = await newInvite(admin, { expiresOn: "2026-06-01" });
    const revoked = await newInvite(admin);

    const home = await (await admin.get("/admin/")).text();
    const revoke = /action="([^"]*\/revoke)"/.exec(home)?.[1] ?? "";
    expect(revoke).toMatch(/^\.\.\/admin\/invites\/.+\/revoke$/);
    const revokedNow = await admin.postForm(
      new URL(revoke, "http://app/admin/").pathname,
      hiddenFields(home),
    );
    expect(revokedNow.status).toBe(303);
    expect(revokedNow.headers.get("location")).toBe("../../../admin/#invites");
    clock.set("2026-06-02T00:00:00Z"); // the instance's zone is UTC: 1 June is over

    for (const { path } of [usedUp, expired, revoked]) {
      const visitor = new TestClient(app);
      const opened = await visitor.get(path);
      expect(opened.status).toBe(404);
      expect(text(await opened.text())).toContain(en("invite.invalid"));
      const _csrf = hiddenFields(await (await visitor.get("/")).text())._csrf ?? "";
      const confirmed = await visitor.postForm("/i", { _csrf, token: path.slice(3) });
      expect(confirmed.status).toBe(404);
      expect(visitor.cookies.has("__Host-rr-device")).toBe(false);
      expect(text(await (await visitor.get("/new")).text())).toContain(en("posting.inviteNeeded"));
    }
  });

  it("keeps invite links out of other URLs and the logs, as every secret link", () => {
    expect(isSecretLinkPath("/i/abc")).toBe(true);
    expect(isSecretLinkPath("/i")).toBe(true);
    expect(isSecretLinkPath("/impressum")).toBe(false);
  });

  it("needs the CSRF token to confirm an invite", async () => {
    const { app, admin } = await setup();
    const { path } = await newInvite(admin);
    const forged = await new TestClient(app).postForm("/i", { token: path.slice(3) });
    expect(forged.status).toBe(403);
  });

  it("also refuses repeating a template on a device that may not post", async () => {
    const { app, admin, config } = await setup();
    const { path } = await newInvite(admin);
    const host = new TestClient(app);
    await useInvite(host, path);
    const { planId } = await createPlanViaUi(host);
    const hostPage = await (await host.get(`/p/${planId}/host`)).text();
    const saveForm = hostPage.slice(hostPage.indexOf(`action="/p/${planId}/host/template"`));
    const saved = await host.postForm(`/p/${planId}/host/template`, hiddenFields(saveForm));
    const templateLink = /https:\/\/runs\.example\.org(\/t\/[A-Za-z0-9_-]{43})/.exec(
      await saved.text(),
    )?.[1];
    expect(templateLink).toBeDefined();
    const other = new TestClient(app);
    const linked = await other.postForm(
      "/t",
      hiddenFields(await (await other.get(templateLink ?? "")).text()),
    );
    const templatePath = linked.headers.get("location") ?? "";
    expect(templatePath).toMatch(/^\/templates\//);
    // The template page explains instead of offering "Repeat"; a form from elsewhere is refused.
    const page = text(await (await other.get(templatePath)).text());
    expect(page).toContain(en("posting.inviteNeeded"));
    expect(page).not.toContain(`action="${templatePath}/repeat"`);
    expect(text(await (await host.get(templatePath)).text())).toContain(
      `action="${templatePath}/repeat"`,
    );
    const repeat = await other.postForm(`${templatePath}/repeat`, {
      ...hiddenFields(page),
      nonce: "n".repeat(22),
      date: "2026-06-14",
      time: "08:00",
    });
    expect(repeat.status).toBe(403);
    expect(text(await repeat.text())).toContain(en("posting.inviteNeeded"));
    expect(config.postingMode).toBe("invite");
  });
});

describe("invite links on the admin page (spec 7 Moderation)", () => {
  it("are created with expiry and usage limit, shown once, and listed with their uses", async () => {
    const { app, admin, database } = await setup();
    const { path, html, created, fields } = await newInvite(admin, {
      expiresOn: "2026-06-30",
      maxUses: "20",
    });
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(created.headers.get("referrer-policy")).toBe("no-referrer");
    expect(text(html)).toContain(en("admin.inviteCreated"));
    expect(JSON.stringify(database.sqlite.prepare("select * from invites").all())).not.toContain(
      path.slice(3),
    );
    await useInvite(new TestClient(app), path);
    const home = text(await (await admin.get("/admin/")).text());
    expect(home).not.toContain(path);
    expect(home).toContain(en("admin.inviteUses", { uses: 1, max: 20 }));
    // The form sent again creates nothing and shows no link.
    const again = await admin.postForm("/admin/invites", {
      ...fields,
      expiresOn: "2026-06-30",
      maxUses: "20",
    });
    expect(again.status).toBe(303);
    expect(database.sqlite.prepare("select count(*) from invites").pluck().get()).toBe(1);
  });

  it("show the form's errors, keeping what was typed", async () => {
    const { admin, database } = await setup();
    const home = await (await admin.get("/admin/")).text();
    const invalid = await admin.postForm("/admin/invites", {
      ...hiddenFields(home.slice(home.indexOf('id="invites"'))),
      expiresOn: "2026-05-01",
      maxUses: "0",
    });
    expect(invalid.status).toBe(422);
    const html = text(await invalid.text());
    expect(html).toContain(en("field.expiry_in_past"));
    expect(html).toContain(en("field.out_of_range"));
    expect(html).toContain('value="2026-05-01"');
    expect(database.sqlite.prepare("select count(*) from invites").pluck().get()).toBe(0);
  });

  it("need the admin session", async () => {
    const { app } = await setup();
    const visitor = new TestClient(app);
    const _csrf = hiddenFields(await (await visitor.get("/")).text())._csrf ?? "";
    const create = await visitor.postForm("/admin/invites", { _csrf, nonce: "n".repeat(22) });
    expect(create.status).toBe(303);
    expect(create.headers.get("location")).toBe("../admin/login");
    const revoke = await visitor.postForm("/admin/invites/x/revoke", { _csrf });
    expect(revoke.status).toBe(303);
  });

  it("say when an invite to revoke does not exist", async () => {
    const { admin } = await setup();
    const home = await (await admin.get("/admin/")).text();
    const unknown = await admin.postForm(
      "/admin/invites/no-such-invite/revoke",
      hiddenFields(home),
    );
    expect(unknown.status).toBe(404);
    expect(text(await unknown.text())).toContain(en("admin.inviteNotFound"));
  });
});

describe("what a device that may post keeps (spec 3.7)", () => {
  it("is listed on the privacy page, on My data and goes with own-data deletion", async () => {
    const { app, admin, database } = await setup();
    expect(text(await (await new TestClient(app).get("/privacy")).text())).toContain(
      en("privacy.invites"),
    );
    const { path } = await newInvite(admin);
    const invited = new TestClient(app);
    await useInvite(invited, path);
    const myData = text(await (await invited.get("/my-data")).text());
    expect(myData).toContain(en("myData.mayPost", { date: "1 June 2026" }));
    const zip = unzipSync(
      new Uint8Array(await (await invited.get("/my-data/export.zip")).arrayBuffer()),
    );
    const exported = JSON.parse(strFromU8(zip["data.json"] ?? new Uint8Array()));
    expect(exported).toMatchObject({ version: 5, mayPostSince: "2026-06-01T08:00:00.000Z" });
    const confirm = text(await (await invited.get("/my-data/delete")).text());
    expect(confirm).toContain(en("myData.deleteMayPost"));
    await invited.postForm("/my-data/delete", hiddenFields(confirm));
    expect(database.sqlite.prepare("select count(*) from permissions").pluck().get()).toBe(0);
    expect(text(await (await invited.get("/new")).text())).toContain(en("posting.inviteNeeded"));
  });

  it("is not mentioned on the privacy page when anyone may post", async () => {
    const { app } = await setup({ ADMIN_TOKEN: TOKEN });
    expect(text(await (await new TestClient(app).get("/privacy")).text())).not.toContain(
      en("privacy.invites"),
    );
  });
});
