// The instance's own pages (design step 5, decisions D27 and D29): errors and "gone" pages as pages
// of the site that say what happened, the admin pages and the privacy notice in parts, the way
// back first, one main action per page.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped, primaries, unsectioned } from "../../support/html.ts";
import { createPlanViaUi } from "../../support/plans.ts";

const en = translator("en");
const TOKEN = "admin-token-for-tests-0123456789abcdef";

/** Whether the answer is a page of the site, and its heading when it only says what happened. */
async function messageOf(response: Response) {
  const html = await response.text();
  return {
    status: response.status,
    page: (response.headers.get("content-type") ?? "").startsWith("text/html"),
    header: html.includes('<header class="site-header">'),
    heading: /<section class="message-page"><h1>([^<]*)<\/h1><\/section>/.exec(html)?.[1],
  };
}

async function adminSetup() {
  const test = await createTestApp({ env: { ADMIN_TOKEN: TOKEN, POSTING_MODE: "invite" } });
  const admin = new TestClient(test.app);
  const fields = hiddenFields(await (await admin.get("/admin/login")).text());
  await admin.postForm("/admin/login", { ...fields, token: TOKEN });
  return { ...test, admin };
}

describe("instance pages (design step 5)", () => {
  it("answer errors with a page of the site that says what happened", async () => {
    const { app } = await createTestApp({ env: { ADMIN_TOKEN: TOKEN } });
    app.get("/boom", () => {
      throw new Error("SENTINEL");
    });
    const client = new TestClient(app);
    const limited = new TestClient(app);
    const login = hiddenFields(await (await limited.get("/admin/login")).text());
    let tooMany: Response | undefined;
    for (let attempt = 0; attempt < 10 && tooMany === undefined; attempt++) {
      const response = await limited.postForm("/admin/login", { ...login, token: "wrong" });
      if (response.status === 429) tooMany = response;
    }
    const answers = {
      csrf: await messageOf(await app.request("/", { method: "POST" })),
      tooLarge: await messageOf(
        await client.postForm("/a", {
          ...hiddenFields(await (await client.get("/new")).text()),
          title: "x".repeat(200_000),
        }),
      ),
      internal: await messageOf(await client.get("/boom")),
      notFound: await messageOf(await client.get("/no-such-page")),
      rateLimited: tooMany === undefined ? undefined : await messageOf(tooMany),
    };
    const page = (status: number, key: Parameters<typeof en>[0]) => ({
      status,
      page: true,
      header: true,
      heading: escaped(en(key)),
    });
    expect(answers).toEqual({
      csrf: page(403, "error.csrf"),
      tooLarge: page(413, "error.tooLarge"),
      internal: page(500, "error.internal"),
      notFound: page(404, "error.notFound"),
      rateLimited: page(429, "error.rateLimited"),
    });
  });

  it("say that a plan or template is gone in the page's heading", async () => {
    const { app } = await createTestApp();
    const client = new TestClient(app);
    const gone = { status: 404, page: true, header: true, heading: escaped(en("plan.gone")) };
    expect([
      await messageOf(await client.get("/p/AAAAAAAAAAAAAAAAAAAAAA")),
      // Every unknown plan ID answers alike (spec 5 feature 9), its calendar download too.
      await messageOf(await client.get("/p/AAAAAAAAAAAAAAAAAAAAAA/calendar.ics")),
      await messageOf(await client.get("/templates/AAAAAAAAAAAAAAAAAAAAAA")),
    ]).toEqual([
      gone,
      gone,
      { status: 404, page: true, header: true, heading: escaped(en("template.gone")) },
    ]);
  });

  it("set no cookie on a page that only says what happened", async () => {
    const { app } = await createTestApp();
    const client = new TestClient(app);
    const responses = [
      await client.get("/no-such-page"),
      await client.get("/p/AAAAAAAAAAAAAAAAAAAAAA"),
    ];
    expect(responses.map((response) => response.headers.get("set-cookie"))).toEqual([null, null]);
    expect(client.cookies.size).toBe(0);
  });

  it("keep the admin's error pages under the admin directory's relative links, unstored", async () => {
    const { admin } = await adminSetup();
    const response = await admin.get("/admin/plans/AAAAAAAAAAAAAAAAAAAAAA/missing");
    expect(await response.text()).toContain('href="../../../static/app.css"');
    // Like every admin response (decision I46).
    expect({
      cache: response.headers.get("cache-control"),
      robots: response.headers.get("x-robots-tag"),
    }).toEqual({ cache: "no-store", robots: "noindex" });
  });

  it("put the admin home and the privacy notice in parts, with one main action", async () => {
    const { app, admin } = await adminSetup();
    const home = await (await admin.get("/admin/")).text();
    const privacy = await (await new TestClient(app).get("/privacy")).text();
    expect({
      homeParts: unsectioned(home),
      homeMain: primaries(home),
      privacyParts: unsectioned(privacy),
    }).toEqual({
      homeParts: [],
      homeMain: [en("admin.findPlanSubmit")],
      privacyParts: [],
    });
  });

  it("start the admin's plan and invite pages with the way back, relative to the admin directory", async () => {
    const { app, admin } = await adminSetup();
    const host = new TestClient(app);
    const home = await (await admin.get("/admin/")).text();
    const created = await (
      await admin.postForm("/admin/invites", {
        ...hiddenFields(home.slice(home.indexOf('id="invites"'))),
        expiresOn: "",
        maxUses: "",
      })
    ).text();
    // A plan needs an invite here: the admin's own invite link lets this browser create one.
    const invitePath = new URL(/<code>([^<]*)<\/code>/.exec(created)?.[1] ?? "").pathname;
    const invite = await (await host.get(invitePath)).text();
    await host.postForm("/i", hiddenFields(invite));
    const { planId } = await createPlanViaUi(host);
    const plan = await (await admin.get(`/admin/plans/${planId}`)).text();
    const backFirst = (html: string, href: string) => {
      const link = html.indexOf(`<p class="back-link"><a href="${href}">`);
      return link > -1 && html.indexOf("<h1") > link;
    };
    expect({
      invite: backFirst(created, "../admin/#invites"),
      plan: backFirst(plan, "../../admin/"),
      planMain: primaries(plan),
      planParts: unsectioned(plan),
    }).toEqual({ invite: true, plan: true, planMain: [], planParts: [] });
    // Its public details as on the plan page: time and place as boxes, the rest in one line.
    expect(plan).toContain('<dl class="when-where">');
    expect(plan).toContain(
      '<span class="icon icon-pin" aria-hidden="true"></span><span>Englischer Garten, north end</span>',
    );
  });
});
