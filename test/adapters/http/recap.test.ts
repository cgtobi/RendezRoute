// The recap through the web pages (spec 6 features 5–7, decisions D19, I42).
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const AFTER_START = "2026-06-07T06:00:00Z";
const section = (html: string) => /<section class="recap"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "Ben", "joined");
  const ida = new TestClient(test.app);
  await respondViaUi(ida, planId, "Ida", "interested");
  return { ...test, host, ben, ida, planId };
}

async function contribute(client: TestClient, planId: string, body: string, linkUrl = "") {
  const csrf = hiddenFields(await (await client.get(`/p/${planId}`)).text())._csrf ?? "";
  return client.postForm(`/p/${planId}/recap`, { _csrf: csrf, body, linkUrl });
}

const csrfOf = async (client: TestClient, planId: string) =>
  hiddenFields(await (await client.get(`/p/${planId}`)).text())._csrf ?? "";

describe("the recap section (spec 6 feature 5)", () => {
  it("appears from the start: everyone sees that it took place, participants see the contributions", async () => {
    const { host, ben, ida, planId, clock, app } = await setup();
    expect(section(await (await ben.get(`/p/${planId}`)).text())).toBe("");
    clock.set(AFTER_START);
    const added = await contribute(
      ben,
      planId,
      "Lovely https://example.org/x",
      "https://www.strava.com/activities/1",
    );
    expect(added.status).toBe(303);
    expect(added.headers.get("location")).toBe(`/p/${planId}#recap`);

    const participant = section(await (await ben.get(`/p/${planId}`)).text());
    expect(participant).toContain("This plan took place. 1 person joined.");
    expect(participant).toContain("Only people who joined this plan can see this.");
    expect(participant).toContain('<span class="service">Strava</span>');
    expect(participant).toContain(
      'href="https://example.org/x" rel="noopener noreferrer nofollow ugc"',
    );
    expect(participant).toContain(`href="/p/${planId}/recap/`);
    expect(participant).toContain('action="/p/' + planId + '/recap"');
    expect(participant).not.toContain("/hide");

    expect(section(await (await host.get(`/p/${planId}`)).text())).toContain("/hide");
    for (const client of [ida, new TestClient(app)]) {
      const html = section(await (await client.get(`/p/${planId}`)).text());
      expect(html).toContain("This plan took place.");
      expect(html).not.toContain("Lovely");
      expect(html).not.toContain('action="/p/');
    }
  });

  it("names the viewer's own contributions Me, the others by name, the host's with the badge", async () => {
    const { host, ben, planId, clock } = await setup();
    clock.set(AFTER_START);
    await contribute(ben, planId, "From Ben");
    await contribute(host, planId, "From Anna");
    const authors = async (client: TestClient) =>
      [
        ...section(await (await client.get(`/p/${planId}`)).text()).matchAll(
          /<p class="contribution-author">(.*?)<\/p>/g,
        ),
      ].map((m) => m[1]);
    expect(await authors(ben)).toEqual([
      '<span class="person-me">Me</span>',
      'Anna <span class="badge">host</span>',
    ]);
    expect(await authors(host)).toEqual([
      "Ben",
      '<span class="person-me">Me</span> <span class="badge">host</span>',
    ]);
    const german = section(
      await (await ben.request(`/p/${planId}`, { headers: { "accept-language": "de" } })).text(),
    );
    expect(german).toContain(
      '<p class="contribution-author"><span class="person-me">Ich</span></p>',
    );
  });

  it("shows errors on the form's own page, and refuses before the start", async () => {
    const { ben, planId, clock } = await setup();
    expect((await contribute(ben, planId, "Too early")).status).toBe(409);
    clock.set(AFTER_START);
    const invalid = await contribute(ben, planId, "", "ftp://example.org");
    expect(invalid.status).toBe(422);
    const html = await invalid.text();
    expect(html).toContain("Enter a web address starting with https://.");
    expect(html).toContain('value="ftp://example.org"');
    const long = await contribute(ben, planId, "x".repeat(1001));
    expect(await long.text()).toContain("Please keep it to 1,000 characters.");
  });

  it("refuses interested people and posts without the CSRF token", async () => {
    const { ida, ben, planId, clock } = await setup();
    clock.set(AFTER_START);
    const refused = await contribute(ida, planId, "Me too");
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe(`/p/${planId}`);
    expect((await ben.postForm(`/p/${planId}/recap`, { body: "x", linkUrl: "" })).status).toBe(403);
  });

  it("limits how often a client adds contributions (decision I32)", async () => {
    const { ben, planId, clock } = await setup();
    clock.set(AFTER_START);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await contribute(ben, planId, `Note ${i}`)).status);
    expect(statuses).toEqual([...Array<number>(10).fill(303), 429]);
  });
});

describe("own contributions and the host's controls", () => {
  it("can be edited and deleted by the author, hidden by the host", async () => {
    const { host, ben, ida, planId, clock } = await setup();
    clock.set(AFTER_START);
    await contribute(ben, planId, "Frist");
    const id =
      /\/recap\/([^/"]+)\/edit/.exec(await (await ben.get(`/p/${planId}`)).text())?.[1] ?? "";
    const edit = await ben.get(`/p/${planId}/recap/${id}/edit`);
    expect(await edit.text()).toContain(">Frist</textarea>");
    expect((await host.get(`/p/${planId}/recap/${id}/edit`)).status).toBe(303);
    const csrf = await csrfOf(ben, planId);
    await ben.postForm(`/p/${planId}/recap/${id}`, { _csrf: csrf, body: "First", linkUrl: "" });
    expect(section(await (await ben.get(`/p/${planId}`)).text())).toContain("First");

    const hostCsrf = await csrfOf(host, planId);
    await host.postForm(`/p/${planId}/recap/${id}/hide`, { _csrf: hostCsrf });
    expect(section(await (await ben.get(`/p/${planId}`)).text())).toContain(
      "Hidden by the host: only you and the host see this.",
    );
    expect(section(await (await host.get(`/p/${planId}`)).text())).toContain("Show again");
    expect(section(await (await ida.get(`/p/${planId}`)).text())).not.toContain("First");

    await ben.postForm(`/p/${planId}/recap/${id}/delete`, { _csrf: csrf });
    expect(section(await (await host.get(`/p/${planId}`)).text())).toContain(
      "No comments or links yet.",
    );
  });

  it("lets the host delete the whole recap from the host page (spec 6 feature 7)", async () => {
    const { host, ben, planId, clock } = await setup();
    clock.set(AFTER_START);
    await contribute(ben, planId, "One");
    await contribute(host, planId, "Two");
    const hostPage = await (await host.get(`/p/${planId}/host`)).text();
    expect(hostPage).toContain("This deletes all 2 comments and links in the recap");
    const response = await host.postForm(`/p/${planId}/host/recap/delete`, hiddenFields(hostPage));
    expect(response.headers.get("location")).toBe(`/p/${planId}#recap`);
    expect(section(await (await ben.get(`/p/${planId}`)).text())).toContain(
      "No comments or links yet.",
    );
  });
});

describe("the recap window on the forms (spec 6 feature 6)", () => {
  it("is offered when creating a plan and after the start", async () => {
    const { host, planId, clock, app } = await setup();
    const create = await new TestClient(app).get("/new");
    expect(await create.text()).toContain(
      '<option value="1w" selected="">Open for 1 week after the start</option>',
    );
    clock.set(AFTER_START);
    const page = await (await host.get(`/p/${planId}/host`)).text();
    expect(page).toContain('name="recapWindow"');
    expect(page).toContain("After the start, a change counts from now.");
  });

  it("says so when a longer window was shortened to fit how long the plan is kept (spec 3.10)", async () => {
    const notice =
      "The recap was shortened to fit how long the plan is kept: Open for 1 day after the start.";
    const test = await createTestApp();
    const host = new TestClient(test.app);
    expect((await createPlanViaUi(host)).html).not.toContain(notice);
    const created = await createPlanViaUi(host, { retentionDays: "3", recapWindow: "1w" });
    expect(created.html).toContain(notice);

    test.clock.set(AFTER_START);
    const { planId } = created;
    const csrf = hiddenFields(await (await host.get(`/p/${planId}/host`)).text())._csrf ?? "";
    const kept = await host.postForm(`/p/${planId}/host`, {
      _csrf: csrf,
      retentionDays: "3",
      recapWindow: "1d",
    });
    expect(kept.headers.get("location")).toBe(`/p/${planId}/host?saved`);
    const longer = await host.postForm(`/p/${planId}/host`, {
      _csrf: csrf,
      retentionDays: "3",
      recapWindow: "1w",
    });
    const location = longer.headers.get("location") ?? "";
    expect(location).toBe(`/p/${planId}/host?saved&recapShortened=1d`);
    expect(await (await host.get(location)).text()).toContain(notice);
  });

  it("shows an invalid choice as an error after the start", async () => {
    const { host, planId, clock } = await setup();
    clock.set(AFTER_START);
    const csrf = hiddenFields(await (await host.get(`/p/${planId}/host`)).text())._csrf ?? "";
    const response = await host.postForm(`/p/${planId}/host`, {
      _csrf: csrf,
      retentionDays: "14",
      recapWindow: "forever",
    });
    expect(response.status).toBe(422);
    expect(await response.text()).toMatch(
      /<div class="field field-invalid"><label for="field-recapWindow">[\s\S]*?<p class="error" id="field-recapWindow-error">/,
    );
  });
});
