// "My data on this device" through the web pages (spec 3.2, 3.7, decision I45).
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host, { keepAsTemplate: "1", title: "Tuesday tempo" });
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "SENTINEL-Ben", "joined");
  return { ...test, host, ben, planId };
}

const unzip = async (response: Response) => unzipSync(new Uint8Array(await response.arrayBuffer()));

describe("the My data page", () => {
  it("is linked from every page and lists the device's items with their tools", async () => {
    const { host, planId } = await setup();
    expect(await (await host.get("/")).text()).toContain(
      `<a href="/my-data">${en("layout.myData")}</a>`,
    );
    const page = await host.get("/my-data");
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    const html = await page.text();
    expect(html).toContain(`href="/p/${planId}/host"`);
    expect(html).toContain(`data-endpoint="/p/${planId}/host/notifications"`);
    expect(html).toContain(`action="/p/${planId}/host/link"`);
    expect(html).toContain('name="from" value="my-data"');
    expect(html).toContain(`href="/p/${planId}/host/export.zip"`);

    const signedOut = await host.postForm(`/p/${planId}/host/sign-out`, {
      ...hiddenFields(html),
      from: "my-data",
    });
    expect(signedOut.headers.get("location")).toBe("/my-data?signedOut=0");
  });

  it("says when nothing is linked", async () => {
    const { app } = await createTestApp();
    const html = await (await new TestClient(app).get("/my-data")).text();
    expect(html).toContain(en("myData.empty"));
    expect(html).not.toContain("/my-data/export.zip");
  });
});

describe("the export (spec 3.7)", () => {
  it("is a ZIP with a versioned data.json and a calendar file per plan", async () => {
    const { host, planId } = await setup();
    const response = await host.get("/my-data/export.zip");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="rendezroute-export-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = await unzip(response);
    expect(Object.keys(files).sort()).toEqual(["data.json", "plans/1-tuesday-tempo/plan.ics"]);
    const data = JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array()));
    expect(data).toMatchObject({
      format: "rendezroute-export",
      version: 4,
      mayPostSince: null,
      account: null,
      plans: [
        {
          role: "host",
          plan: {
            id: planId,
            title: "Tuesday tempo",
            participants: ["Anna", "SENTINEL-Ben"],
          },
          ownRating: null,
          ratingResult: null,
          files: { calendar: "plans/1-tuesday-tempo/plan.ics" },
        },
      ],
      templates: [],
      calendarFeed: false,
    });
    expect(strFromU8(files["plans/1-tuesday-tempo/plan.ics"] ?? new Uint8Array())).toContain(
      "SUMMARY:Tuesday tempo",
    );
  });

  it("is offered per plan and per response, and to nobody else", async () => {
    const { host, ben, app, planId } = await setup();
    expect((await host.get(`/p/${planId}/host`)).ok).toBe(true);
    expect(await (await host.get(`/p/${planId}/host`)).text()).toContain(
      `href="/p/${planId}/host/export.zip"`,
    );
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(
      `href="/p/${planId}/me/export.zip"`,
    );
    const benFiles = await unzip(await ben.get(`/p/${planId}/me/export.zip`));
    const benData = JSON.parse(strFromU8(benFiles["data.json"] ?? new Uint8Array()));
    expect(benData.plans).toHaveLength(1);
    expect(benData.plans[0].role).toBe("response");

    expect((await ben.get(`/p/${planId}/host/export.zip`)).status).toBe(404);
    expect((await host.get(`/p/${planId}/me/export.zip`)).status).toBe(404);
    expect((await new TestClient(app).get("/my-data/export.zip")).status).toBe(404);
  });
});

describe("ratings in the export (spec 6a)", () => {
  it("hold the participant's own rating, and the host's result once due, in data.json", async () => {
    const { host, ben, app, planId, clock } = await setup();
    const lea = new TestClient(app);
    await respondViaUi(lea, planId, "Lea", "joined");
    await respondViaUi(new TestClient(app), planId, "Max", "joined");
    clock.set("2026-06-07T06:00:00Z");
    for (const [client, value, note] of [
      [ben, "down", "Too fast"],
      [lea, "up", ""],
    ] as const) {
      const _csrf = hiddenFields(await (await client.get(`/p/${planId}`)).text())._csrf ?? "";
      await client.postForm(`/p/${planId}/rating`, { _csrf, value, note });
    }
    const dataOf = async (client: TestClient, path: string) => {
      const files = await unzip(await client.get(path));
      return JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array()));
    };

    const leaData = await dataOf(lea, `/p/${planId}/me/export.zip`);
    expect(leaData.plans[0]).toMatchObject({
      ownRating: { value: "up", note: null },
      ratingResult: null,
    });
    expect((await dataOf(host, `/p/${planId}/host/export.zip`)).plans[0].ratingResult).toBeNull();

    clock.set("2026-06-14T05:30:00Z");
    const hostData = await dataOf(host, "/my-data/export.zip");
    expect(hostData.plans[0]).toMatchObject({
      role: "host",
      ownRating: null,
      ratingResult: {
        participants: 3,
        rated: 2,
        up: 1,
        down: 1,
        notes: [{ author: "SENTINEL-Ben", value: "down", note: "Too fast" }],
      },
    });
  });
});

describe("the template export (spec 3.10)", () => {
  it("is offered on the template page, to linked devices only", async () => {
    const { host, app, planId } = await setup();
    const fields = hiddenFields(await (await host.get(`/p/${planId}/host`)).text());
    const saved = await host.postForm(`/p/${planId}/host/template`, fields);
    const templateId = /href="\/templates\/([\w-]+)"/.exec(await saved.text())?.[1] ?? "";
    expect(await (await host.get(`/templates/${templateId}`)).text()).toContain(
      `href="/templates/${templateId}/export.zip"`,
    );
    const files = await unzip(await host.get(`/templates/${templateId}/export.zip`));
    const data = JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array()));
    expect(data).toMatchObject({
      plans: [],
      templates: [{ template: { id: templateId, title: "Tuesday tempo", startTime: "07:30" } }],
    });
    expect((await new TestClient(app).get(`/templates/${templateId}/export.zip`)).status).toBe(404);
  });
});

describe("Delete my data (spec 3.7)", () => {
  it("lists what goes by name, deletes it all with the device and leaves no trace", async () => {
    const { host, planId, database, app, clock } = await setup();
    // This device also joined someone else's plan and wrote in its recap.
    const otherHost = new TestClient(app);
    const other = await createPlanViaUi(otherHost, { title: "Someone else's ride" });
    await respondViaUi(host, other.planId, "SENTINEL-me", "joined");
    const ida = new TestClient(app);
    await respondViaUi(ida, other.planId, "Ida", "joined");
    clock.set("2026-06-07T06:00:00Z");
    const recapCsrf = hiddenFields(await (await host.get(`/p/${other.planId}`)).text())._csrf;
    await host.postForm(`/p/${other.planId}/recap`, {
      _csrf: recapCsrf ?? "",
      body: "SENTINEL-my-words",
      linkUrl: "",
    });
    const one = (sql: string) => String(database.sqlite.prepare(sql).pluck().get());
    const deviceId = one(`select device_id from device_links where plan_id = '${planId}'`);
    const myResponse = one(
      `select response_id from device_links where device_id = '${deviceId}' and response_id is not null`,
    );
    const myContribution = one(
      `select id from recap_contributions where response_id = '${myResponse}'`,
    );

    for (const id of [deviceId, myResponse, myContribution]) expect(id).not.toBe("undefined");
    const confirm = await (await host.get("/my-data/delete")).text();
    expect(confirm).toContain(en("myData.deletePlans", { count: 1 }));
    expect(confirm).toContain("<li>Tuesday tempo</li>");
    expect(confirm).toContain("<li>Someone else&#39;s ride</li>");
    expect(confirm).toContain(en("myData.deleteNoTemplates"));

    const deleted = await host.postForm("/my-data/delete", hiddenFields(confirm));
    expect(deleted.headers.get("location")).toBe("/?dataDeleted");
    expect(deleted.headers.getSetCookie().join()).toMatch(/rr-device=; Max-Age=0/);
    expect(await (await host.get("/?dataDeleted")).text()).toContain(en("myData.deleted"));
    expect((await host.get(`/p/${planId}`)).status).toBe(404);

    const tables = database.sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .pluck()
      .all() as string[];
    for (const table of tables) {
      const rows = JSON.stringify(database.sqlite.prepare(`select * from "${table}"`).all());
      expect({
        table,
        found: [planId, deviceId, myResponse, myContribution].filter((id) => rows.includes(id)),
      }).toEqual({ table, found: [] });
    }
    // No template was kept, although the plan asked for one: this is not a host deletion.
    expect(one("select count(*) from plan_templates")).toBe("0");
    // Other people's data stays: the other plan, Ida's response.
    expect((await otherHost.get(`/p/${other.planId}`)).status).toBe(200);
    expect(await (await otherHost.get(`/p/${other.planId}/host`)).text()).toContain("Ida");
  });
});
