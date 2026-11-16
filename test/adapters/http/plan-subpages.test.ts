// The pages around a plan (design step 3, decision D27): the way back to the plan comes first, one
// main action per page, the host page naming its plan and showing initials for people, and one's
// own response shown as on the plan page.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { avatarOf } from "../../../src/adapters/in/http/views/avatar.tsx";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { primaries } from "../../support/html.ts";
import { createPlanViaUi, hostActsOn, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";

async function setup() {
  const test = await createTestApp({ env: { ADMIN_TOKEN } });
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host, { joinMode: "approval" });
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "Ben", "requested");
  const html = async (client: TestClient, path: string) => (await client.get(path)).text();
  return { ...test, host, ben, planId, html };
}

describe("pages about a plan (design step 3)", () => {
  it("start with the way back to the plan, before the page's heading", async () => {
    const { host, ben, planId, html, clock, app } = await setup();
    await hostActsOn(host, planId, "accept", "Ben");
    const csrf = hiddenFields(await html(ben, `/p/${planId}`))._csrf ?? "";
    // A visitor's form, sent once responses have closed.
    const late = new TestClient(app);
    const lateForm = hiddenFields(await html(late, `/p/${planId}`));
    const rate = (value: string) =>
      ben.postForm(`/p/${planId}/rating`, { _csrf: csrf, value, note: "" });
    const beforeStart = [
      await html(host, `/p/${planId}/host`),
      await html(host, `/p/${planId}/host/delete`),
      await html(ben, `/p/${planId}/me`),
      await html(ben, `/p/${planId}/report`),
      await html(ben, `/p/${planId}/report?sent`),
      await (await rate("up")).text(),
    ];
    clock.advance({ days: 7 });
    await ben.postForm(`/p/${planId}/recap`, { _csrf: csrf, body: "Thanks!", linkUrl: "" });
    const edit = /\/recap\/([^/"]+)\/edit/.exec(await html(ben, `/p/${planId}`))?.[1] ?? "";
    const afterStart = [
      await html(ben, `/p/${planId}/recap/${edit}/edit`),
      await (await rate("sideways")).text(),
      await (
        await late.postForm(`/p/${planId}/respond`, {
          ...lateForm,
          displayName: "Lia",
          // The plan only takes requests (approval mode).
          choice: "requested",
        })
      ).text(),
    ];
    const PAGES = [
      "host page",
      "delete confirmation",
      "own response",
      "report form",
      "report sent",
      "rating not open yet",
      "recap edit",
      "rating form",
      "responses closed",
    ];
    const found = [...beforeStart, ...afterStart].map((page, index) => {
      const back = page.indexOf(`<p class="back-link"><a href="/p/${planId}`);
      const heading = page.indexOf("<h1");
      return { page: PAGES[index], backFirst: back > -1 && heading > back };
    });
    expect(found).toEqual(PAGES.map((page) => ({ page, backFirst: true })));
  });

  it("give each of them at most one main action", async () => {
    const { host, ben, planId, html, clock } = await setup();
    await hostActsOn(host, planId, "accept", "Ben");
    const csrf = hiddenFields(await html(ben, `/p/${planId}`))._csrf ?? "";
    expect(primaries(await html(host, `/p/${planId}/host`))).toEqual([en("host.save")]);
    expect(primaries(await html(ben, `/p/${planId}/me`))).toEqual([en("manage.save")]);
    expect(primaries(await html(ben, `/p/${planId}/report`))).toEqual([en("report.submit")]);
    clock.advance({ days: 7 });
    await ben.postForm(`/p/${planId}/recap`, { _csrf: csrf, body: "Thanks!", linkUrl: "" });
    const edit = /\/recap\/([^/"]+)\/edit/.exec(await html(ben, `/p/${planId}`))?.[1] ?? "";
    const rating = await ben.postForm(`/p/${planId}/rating`, {
      _csrf: csrf,
      value: "sideways",
      note: "",
    });
    // After the start the host may only change how long the plan is kept (spec 3.1).
    expect(primaries(await html(host, `/p/${planId}/host`))).toEqual([en("host.save")]);
    expect(primaries(await html(ben, `/p/${planId}/recap/${edit}/edit`))).toEqual([
      en("recap.save"),
    ]);
    expect(primaries(await rating.text())).toEqual([en("rating.submit")]);
  });

  it("name the plan above the host page's heading once started, when the form is not editable (D11, D71)", async () => {
    const { host, planId, html, clock } = await setup();
    const editable = await html(host, `/p/${planId}/host`);
    // Before the start the title is the form's own input: no second, small title line (D71).
    expect(editable).not.toContain('<p class="plan-context">');
    expect(editable).toContain('name="title"');
    clock.advance({ days: 7 });
    const page = await html(host, `/p/${planId}/host`);
    expect(page.indexOf('<p class="plan-context">Easy Sunday run</p>')).toBeLessThan(
      page.indexOf("<h1"),
    );
    expect(page).not.toContain("theme.css");
  });

  it("show people on the host page with their initials, as requests and once in", async () => {
    const { host, planId, html } = await setup();
    const initial = `<span class="person-name"><span class="avatar avatar-${avatarOf("Ben", "en").hue}" aria-hidden="true">B</span>Ben</span>`;
    expect(await html(host, `/p/${planId}/host`)).toContain(initial);
    await hostActsOn(host, planId, "accept", "Ben");
    const page = await html(host, `/p/${planId}/host`);
    expect(page.slice(page.indexOf(en("host.participants")))).toContain(initial);
  });

  it("show one's own response as a status, as on the plan page", async () => {
    const { ben, planId, html } = await setup();
    const page = await html(ben, `/p/${planId}/me`);
    expect(page).toContain('<section class="status status-requested">');
    expect(page).toContain(`<p>${en("status.requested")}</p>`);
  });
});
