// The instance-wide cap on new plans and the disk guard, through the web pages (0.19.0 commit A).
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { sampleGpx } from "../../support/gpx.ts";
import { escaped } from "../../support/html.ts";
import {
  createPlanViaUi,
  editForm,
  planForm,
  respondViaUi,
  uploadViaEdit,
} from "../../support/plans.ts";

const en = translator("en");
const de = translator("de");
const fr = translator("fr");

class Browser extends TestClient {
  constructor(
    app: ConstructorParameters<typeof TestClient>[0],
    private readonly language: string,
  ) {
    super(app);
  }

  override request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("accept-language", this.language);
    return super.request(path, { ...init, headers });
  }
}

const createPlanForm = async (client: TestClient) => {
  const hidden = await client.hiddenFields("/new");
  return client.postForm("/new", { ...hidden, ...planForm() });
};

describe("the busy page for new plans", () => {
  it("answers 503 with Retry-After and a friendly page when new plans are paused", async () => {
    const { app } = await createTestApp({ env: { MAX_NEW_PLANS_PER_DAY: "0" } });
    const client = new TestClient(app);
    const refused = await createPlanForm(client);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("3600");
    expect(await refused.text()).toContain(
      `<main><section class="message-page"><h1>${escaped(en("error.instanceBusy"))}</h1></section></main>`,
    );
  });

  it("gives back the client's token, so a busy instance never costs the 5-plan burst", async () => {
    const { app } = await createTestApp({ env: { MAX_NEW_PLANS_PER_DAY: "0" } });
    const client = new TestClient(app);
    for (let i = 0; i < 8; i++) expect((await createPlanForm(client)).status).toBe(503);
  });

  it("is translated: English, German and French", async () => {
    const { app } = await createTestApp({ env: { MAX_NEW_PLANS_PER_DAY: "0" } });
    const german = await createPlanForm(new Browser(app, "de"));
    expect(await german.text()).toContain(escaped(de("error.instanceBusy")));
    const french = await createPlanForm(new Browser(app, "fr"));
    expect(await french.text()).toContain(escaped(fr("error.instanceBusy")));
    expect(
      new Set([en("error.instanceBusy"), de("error.instanceBusy"), fr("error.instanceBusy")]).size,
    ).toBe(3);
  });

  it("stops at the daily cap and blocks nothing but new plans and Repeat", async () => {
    const test = await createTestApp({ env: { MAX_NEW_PLANS_PER_DAY: "2" } });
    const host = new TestClient(test.app);
    const { planId, hostPath } = await createPlanViaUi(host);
    // A template from the first plan, made before the cap is reached.
    const saved = await host.postForm(
      `/p/${planId}/host/template`,
      hiddenFields(await (await host.get(`/p/${planId}/host`)).text()),
    );
    const templateId = /href="\/templates\/([\w-]+)"/.exec(await saved.text())?.[1] ?? "";
    expect(templateId).not.toBe("");
    await createPlanViaUi(new TestClient(test.app));

    const third = await createPlanForm(new TestClient(test.app));
    expect(third.status).toBe(503);

    const repeat = await host.postForm(`/templates/${templateId}/repeat`, {
      ...hiddenFields(await (await host.get(`/templates/${templateId}`)).text()),
      date: "2026-07-05",
      time: "08:00",
    });
    expect(repeat.status).toBe(503);
    expect(repeat.headers.get("retry-after")).toBe("3600");

    // Everything else keeps working.
    const guest = new TestClient(test.app);
    expect((await respondViaUi(guest, planId, "Ben", "joined")).response.status).toBe(200);
    expect((await host.get(hostPath)).status).toBeLessThan(400);
    expect((await host.get(`/p/${planId}/host`)).status).toBe(200);
    expect((await guest.get(`/p/${planId}`)).status).toBe(200);
  });

  it("counts from the stored plans, so another day's plans make room again", async () => {
    const test = await createTestApp({ env: { MAX_NEW_PLANS_PER_DAY: "1" } });
    await createPlanViaUi(new TestClient(test.app));
    expect((await createPlanForm(new TestClient(test.app))).status).toBe(503);
    test.clock.advance({ hours: 25 });
    expect((await createPlanForm(new TestClient(test.app))).status).toBe(200);
  });
});

describe("the disk guard (0.19.0)", () => {
  it("refuses new plans at the critical level only, with the busy page", async () => {
    const test = await createTestApp();
    const client = new TestClient(test.app);
    test.storage.level = "low";
    expect((await createPlanForm(client)).status).toBe(200);
    test.storage.level = "critical";
    const refused = await createPlanForm(client);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("3600");
    expect(await refused.text()).toContain(escaped(en("error.instanceBusy")));
    test.storage.level = "ok";
    expect((await createPlanForm(client)).status).toBe(200);
  });

  it("refuses a route file in a host edit at the critical level and keeps everything else", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    test.storage.level = "critical";
    const refused = await uploadViaEdit(host, planId, sampleGpx(), { gpxTrim: "0" });
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain(escaped(en("field.storage_low")));

    const guest = new TestClient(test.app);
    expect((await respondViaUi(guest, planId, "Ben", "joined")).response.status).toBe(200);
    expect((await host.get(`/p/${planId}/host`)).status).toBe(200);
    // The same edit without a file saves.
    const edit = await host.postForm(`/p/${planId}/host`, {
      ...(await editForm(host, planId)),
      title: "Renamed run",
    });
    expect(edit.status).toBe(303);
    test.storage.level = "low";
    expect((await uploadViaEdit(host, planId, sampleGpx(), { gpxTrim: "0" })).status).toBe(303);
  });

  it("does not spend the client's route-file tokens on uploads refused before parsing", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    test.storage.level = "critical";
    // The route limit is a burst of 10: all refusals are the disk's, none is "too many".
    for (let i = 0; i < 12; i++) {
      expect((await uploadViaEdit(host, planId, sampleGpx(), { gpxTrim: "0" })).status).toBe(422);
    }
    const hidden = await host.hiddenFields("/new");
    for (let i = 0; i < 12; i++) {
      const refused = await host.postMultipart(
        "/new",
        { ...hidden, ...planForm() },
        { gpx: { name: "route.gpx", content: sampleGpx() } },
      );
      expect(refused.status).toBe(503);
    }
    test.storage.level = "ok";
    expect((await uploadViaEdit(host, planId, sampleGpx(), { gpxTrim: "0" })).status).toBe(303);
  });
});
