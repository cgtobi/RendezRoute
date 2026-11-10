// One's own data and the account (design step 4, decision D27): the way back first, one main
// action per page, sections divided like the host page, the account's state as a status, the
// template's facts as on the plan page, and lists whose items read title, when, then actions.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { primaries } from "../../support/html.ts";
import { createPlanViaUi } from "../../support/plans.ts";
import { FakeOidcServer } from "../../fakes/oidc-server.ts";
import { FakeMastodonServer } from "../../fakes/mastodon-server.ts";
import { PlanMetrics } from "../../../src/adapters/in/http/views/plan-metrics.tsx";

const en = translator("en");
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');
const OIDC_NAME = "Club login";

async function setup() {
  const oidc = new FakeOidcServer();
  const test = await createTestApp({
    env: { ...oidc.env(), OIDC_NAME, FEDIVERSE_LOGIN: "true" },
    oidc,
    mastodon: [new FakeMastodonServer()],
  });
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  const html = async (client: TestClient, path: string) =>
    text(await (await client.get(path)).text());
  // "Save as template" on the host page: the page showing the template link, once.
  const hostPage = await html(host, `/p/${planId}/host`);
  const saveForm = hostPage.slice(hostPage.indexOf(`action="/p/${planId}/host/template"`));
  const saved = text(
    await (await host.postForm(`/p/${planId}/host/template`, hiddenFields(saveForm))).text(),
  );
  const templateId = /href="\/templates\/([\w-]+)"/.exec(saved)?.[1] ?? "";
  /** Logs `client` in through the provider and the callback. */
  const logIn = async (client: TestClient) => {
    const started = await client.get("/login/oidc");
    const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), {
      sub: "sub-anna",
      name: "Anna",
    });
    await client.get(`${callback.pathname}${callback.search}`);
  };
  /** The page before the fediverse server, for `client`. */
  const continueLogin = async (client: TestClient) => {
    const account = await html(client, "/account");
    const form = account.slice(account.indexOf('action="/login/fediverse"'));
    return text(
      await (
        await client.postForm("/login/fediverse", {
          ...hiddenFields(form),
          server: "@anna@social.example",
        })
      ).text(),
    );
  };
  return { ...test, oidc, host, planId, templateId, saved, html, logIn, continueLogin };
}

const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);

/**
 * What stands outside the page's parts: h2s that start no section, and anything after the first
 * part that is not itself a part (a direct child of the `.sectioned` page that is not a section).
 */
function unsectioned(html: string): string[] {
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  const lone = [...main.matchAll(/(<section\b[^>]*>)?<h2\b[^>]*>([\s\S]*?)<\/h2>/g)]
    .filter(([, section]) => section === undefined)
    .map(([, , heading = ""]) => `h2: ${heading.replace(/<[^>]*>/g, "")}`);
  const root = main.search(/<section class="[^"]*\bsectioned\b/);
  const stack: string[] = [];
  let parts = false;
  const loose: string[] = [];
  for (const [tag = "", closing, name = ""] of main.slice(root).matchAll(/<(\/?)(\w+)\b[^>]*>/g)) {
    if (VOID.has(name)) continue;
    if (closing === "/") {
      stack.pop();
      if (stack.length === 0) break;
      continue;
    }
    if (stack.length === 1) {
      if (name === "section") parts = true;
      else if (parts) loose.push(tag);
    }
    stack.push(name);
  }
  return [...lone, ...loose];
}

describe("own data and account pages (design step 4)", () => {
  it("start with the way back, before the page's heading", async () => {
    const { app, oidc, host, templateId, html, logIn, continueLogin } = await setup();
    const pages: [string, string, string][] = [
      ["template edit", `/templates/${templateId}/edit`, `/templates/${templateId}`],
      ["my data delete", "/my-data/delete", "/my-data"],
      ["calendar", "/calendar", "/my-data"],
    ];
    const found = [];
    for (const [name, path, back] of pages) {
      const page = await html(host, path);
      const link = page.indexOf(`<p class="back-link"><a href="${back}">`);
      found.push({ name, backFirst: link > -1 && page.indexOf("<h1") > link });
    }
    // The login pages lead back to the account page: a failed login (a callback opened in
    // another browser) and the step before a fediverse server.
    const visitor = new TestClient(app);
    const started = await visitor.get("/login/oidc");
    const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), { sub: "x" });
    const loginPages: [string, string][] = [
      [
        "login failed",
        text(
          await (await new TestClient(app).get(`${callback.pathname}${callback.search}`)).text(),
        ),
      ],
      ["continue login", await continueLogin(new TestClient(app))],
    ];
    for (const [name, page] of loginPages) {
      const link = page.indexOf('<p class="back-link"><a href="/account">');
      found.push({ name, backFirst: link > -1 && page.indexOf("<h1") > link });
    }
    await logIn(host);
    const deletion = await html(host, "/account/delete");
    const link = deletion.indexOf('<p class="back-link"><a href="/account">');
    found.push({ name: "account delete", backFirst: link > -1 && deletion.indexOf("<h1") > link });
    expect(found).toEqual(
      [...pages.map(([name]) => name), "login failed", "continue login", "account delete"].map(
        (name) => ({ name, backFirst: true }),
      ),
    );
  });

  it("give each page at most one main action", async () => {
    const { app, host, templateId, saved, html, logIn, continueLogin } = await setup();
    const visitor = new TestClient(app);
    const calendarForm = hiddenFields(await html(host, "/calendar"));
    const calendarLink = text(await (await host.postForm("/calendar", calendarForm)).text());
    const loggedOut = await html(visitor, "/account");
    const continuePage = await continueLogin(visitor);
    const before = {
      home: primaries(await html(visitor, "/")),
      homeWithTemplates: primaries(await html(host, "/")),
      template: primaries(await html(host, `/templates/${templateId}`)),
      templateSaved: primaries(saved),
      templateEdit: primaries(await html(host, `/templates/${templateId}/edit`)),
      myData: primaries(await html(host, "/my-data")),
      myDataDelete: primaries(await html(host, "/my-data/delete")),
      calendarLink: primaries(calendarLink),
      loggedOut: primaries(loggedOut),
      continueLogin: primaries(continuePage),
    };
    expect(before).toEqual({
      home: [en("home.cta")],
      homeWithTemplates: [en("home.cta")],
      template: [en("template.repeatSubmit")],
      templateSaved: [en("template.open")],
      templateEdit: [en("template.save")],
      myData: [],
      myDataDelete: [],
      calendarLink: [en("calendar.subscribe")],
      // Another way to log in follows as a secondary.
      loggedOut: [en("account.loginWith", { name: OIDC_NAME })],
      continueLogin: [en("account.continue", { server: "social.example" })],
    });
    await logIn(host);
    // What this browser made before logging in can move into the account: the main action.
    expect(primaries(await html(host, "/account"))).toEqual([en("account.claimSubmit")]);
    await host.postForm("/account/claim", hiddenFields(await html(host, "/account")));
    expect(primaries(await html(host, "/account"))).toEqual([]);
    expect(primaries(await html(host, "/account/delete"))).toEqual([]);
  });

  it("make the fediverse form the main action when it is the only way to log in", async () => {
    const test = await createTestApp({
      env: { FEDIVERSE_LOGIN: "true" },
      mastodon: [new FakeMastodonServer()],
    });
    const page = await (await new TestClient(test.app).get("/account")).text();
    expect(primaries(page)).toEqual([en("account.fediverseSubmit")]);
  });

  it("put every part of My data, the account, the template and the calendar page in its own section", async () => {
    const { host, templateId, html, logIn } = await setup();
    const calendarForm = hiddenFields(await html(host, "/calendar"));
    const before = {
      myData: unsectioned(await html(host, "/my-data")),
      template: unsectioned(await html(host, `/templates/${templateId}`)),
      calendar: unsectioned(await html(host, "/calendar")),
      calendarLink: unsectioned(
        text(await (await host.postForm("/calendar", calendarForm)).text()),
      ),
      calendarActive: unsectioned(await html(host, "/calendar")),
    };
    await logIn(host);
    expect({ ...before, account: unsectioned(await html(host, "/account")) }).toEqual({
      myData: [],
      template: [],
      calendar: [],
      calendarLink: [],
      calendarActive: [],
      account: [],
    });
  });

  it("show the account as a status, saying once that this browser is logged in", async () => {
    const { host, html, logIn } = await setup();
    await logIn(host);
    const status = (page: string) =>
      /<section class="status status-loggedIn"[^>]*>[\s\S]*?<p>([^<]*)<\/p>/.exec(page)?.[1];
    const justLoggedIn = await html(host, "/account?loggedIn");
    expect(status(justLoggedIn)).toBe(en("account.loggedIn"));
    // Announced like the notice it replaces, with the tick of being in.
    expect(justLoggedIn).toContain(
      '<section class="status status-loggedIn" role="status"><span class="status-icon" aria-hidden="true">',
    );
    expect(justLoggedIn).not.toContain(en("account.linked"));
    expect(justLoggedIn.split(en("account.loggedIn"))).toHaveLength(2);
    const later = await html(host, "/account");
    expect(status(later)).toBe(en("account.linked"));
    expect(later).toContain('<section class="status status-loggedIn"><span class="status-icon"');
  });

  it("shows a template's time and place as on the plan page, the other settings in one line", async () => {
    const { host, templateId, html } = await setup();
    const page = await html(host, `/templates/${templateId}`);
    const when = page.slice(page.indexOf('<dl class="when-where">'));
    expect(when).toMatch(
      /^<dl class="when-where"><div class="pill"><dt class="visually-hidden">[^<]*<\/dt><dd><span class="icon icon-calendar" aria-hidden="true"><\/span><span>[^<]*07:30/,
    );
    expect(when).toContain(
      '<span class="icon icon-pin" aria-hidden="true"></span><span>Englischer Garten, north end</span>',
    );
    expect(page).toContain(`<div class="metric"><dt>${en("plan.distance")}</dt><dd>12.5 km</dd>`);
    expect(page).toContain(
      `<p class="item-meta">${[
        en("activity.run"),
        en("form.joinOpen"),
        en("form.retentionDays", { count: 14 }),
      ].join(" · ")}`,
    );
    // Repeating is the page's main action: it comes before editing, exporting and removing.
    expect(page.indexOf(`<h2>${en("template.repeatHeading")}</h2>`)).toBeGreaterThan(-1);
    expect(page.indexOf(`<h2>${en("template.repeatHeading")}</h2>`)).toBeLessThan(
      page.indexOf(`href="/templates/${templateId}/edit"`),
    );
  });

  it("leaves out the measures when a plan or template has none", () => {
    const NO_MEASURES = {
      activity: "run",
      distanceMeters: undefined,
      elevationGainMeters: undefined,
      pace: undefined,
    } as const;
    const none = PlanMetrics({
      t: en,
      details: { ...NO_MEASURES },
      units: "metric",
      language: "en",
    });
    const some = PlanMetrics({
      t: en,
      details: { ...NO_MEASURES, distanceMeters: 5000 },
      units: "metric",
      language: "en",
    });
    expect(none).toBeNull();
    expect(some).not.toBeNull();
  });

  it("list items as their title, then when, then their actions", async () => {
    const { host, planId, templateId, html } = await setup();
    const home = await html(host, "/");
    expect(home).toContain(
      `<li class="item"><a class="item-title" href="/templates/${templateId}">Easy Sunday run</a><p class="item-meta">${en("activity.run")} · 07:30 (Europe/Berlin) · Englischer Garten, north end</p></li>`,
    );
    const myData = await html(host, "/my-data");
    const item = myData.slice(
      myData.indexOf(`<li class="item"><a class="item-title" href="/p/${planId}/host">`),
    );
    const order = [
      item.indexOf('class="item-title"'),
      item.indexOf('<p class="item-meta">'),
      item.indexOf('<div class="item-actions">'),
      item.indexOf(`href="/p/${planId}/host/export.zip"`),
    ];
    expect(
      order.every((at, index) => at > -1 && (index === 0 || at > (order[index - 1] ?? 0))),
    ).toBe(true);
  });
});
