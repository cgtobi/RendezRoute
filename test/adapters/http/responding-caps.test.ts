// Responding in clubs: the burst, the hard cap per plan and the shared cap on notices to the host
// (0.19.0 commit A, ADR 009 decision 5), and the per-plan cap on web reports.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { respond } from "../../../src/application/responses.ts";
import { MAX_WEB_RESPONSES_PER_PLAN } from "../../../src/domain/responding.ts";
import { createTestApp, type TestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const de = translator("de");
const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";

/** A browser behind the trusted proxy, seen with the given address. */
class ClientAt extends TestClient {
  constructor(
    app: ConstructorParameters<typeof TestClient>[0],
    private readonly ip: string,
    private readonly language = "en",
  ) {
    super(app);
  }

  override request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("x-forwarded-for", this.ip);
    headers.set("accept-language", this.language);
    return super.request(path, { ...init, headers });
  }
}

async function subscribeHost(host: TestClient, planId: string) {
  const token = (await host.hiddenFields("/new"))._csrf ?? "";
  await host.request(`/p/${planId}/host/notifications`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": token },
    body: JSON.stringify({
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        expirationTime: null,
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
      },
    }),
  });
}

/** The notices queued for the host, by kind. */
const hostNotices = async (test: TestApp) =>
  (await test.jobs.due(test.clock.now(), 1000)).flatMap((job) => {
    const notification = (job.payload as { notification?: { kind: string } }).notification;
    return notification === undefined ? [] : [notification.kind];
  });

const responseCount = (test: TestApp) =>
  test.database.sqlite.prepare("select count(*) from responses").pluck().get() as number;

describe("a club joining one plan from one address (decision 5)", () => {
  it("lets 40 joins from one IP in an hour all succeed, and tells the host of at most 20 an hour", async () => {
    const test = await createTestApp({ env: { TRUST_PROXY: "true" } });
    const host = new ClientAt(test.app, "198.51.100.1");
    const { planId } = await createPlanViaUi(host);
    await subscribeHost(host, planId);
    const join = async (i: number) =>
      (await respondViaUi(new ClientAt(test.app, "203.0.113.9"), planId, `Runner ${i}`, "joined"))
        .response.status;

    // The burst of 30, all at once.
    for (let i = 0; i < 30; i++) expect(await join(i)).toBe(200);
    // The 31st is refused now (not allowed 30 and then some), but 5 minutes bring 10 more.
    expect(await join(30)).toBe(429);
    test.clock.advance({ minutes: 5 });
    for (let i = 30; i < 40; i++) expect(await join(i)).toBe(200);

    expect(responseCount(test)).toBe(40);
    // 20 at once, and the cap refills 20 an hour: one more in the 5 minutes since. Never 40.
    const notices = await hostNotices(test);
    expect(notices.length).toBeGreaterThanOrEqual(20);
    expect(notices.length).toBeLessThanOrEqual(21);
  });

  it("drops only the notice: the join and the confirmation page are the same", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    await subscribeHost(host, planId);
    // The shared bucket of the plan, used up as 20 fediverse joins would.
    for (let i = 0; i < 20; i++) test.joinLimits.notifyPlan.take(planId);
    const ben = new TestClient(test.app);
    const joined = await respondViaUi(ben, planId, "Ben", "joined");
    expect(joined.response.status).toBe(200);
    expect(joined.managePath).toBeDefined();
    expect(responseCount(test)).toBe(1);
    expect(await hostNotices(test)).toEqual([]);
    // Four minutes on, the cap has refilled a token (20 an hour), so a notice goes again.
    test.clock.advance({ minutes: 4 });
    await respondViaUi(new TestClient(test.app), planId, "Cleo", "joined");
    expect(await hostNotices(test)).toEqual(["newResponse"]);
  });

  it("drops the notice of a switch to joining on the manage page too, and keeps the change", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    await subscribeHost(host, planId);
    const ben = new TestClient(test.app);
    await respondViaUi(ben, planId, "Ben", "interested");
    await test.jobs.due(test.clock.now(), 1000);
    const before = (await hostNotices(test)).length;
    for (let i = 0; i < 20; i++) test.joinLimits.notifyPlan.take(planId);
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    const saved = await ben.postForm(`/p/${planId}/me`, {
      ...hiddenFields(page),
      choice: "joined",
      displayName: "Ben",
    });
    expect(saved.status).toBe(303);
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(escaped(en("status.joined")));
    expect((await hostNotices(test)).length).toBe(before);
  });
});

describe("at most 300 web responses a plan", () => {
  it("refuses a new join with a clear, translated message", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    for (let i = 0; i < MAX_WEB_RESPONSES_PER_PLAN; i++) {
      const added = await respond(test.planDeps, {
        planId,
        choice: "interested",
        displayName: `Person ${i}`,
        language: "en",
        creationNonce: `nonce-${String(i).padStart(16, "0")}`,
        deviceToken: undefined,
      });
      expect(added.kind).toBe("created");
    }
    const refused = await respondViaUi(new TestClient(test.app), planId, "One too many", "joined");
    expect(refused.response.status).toBe(409);
    expect(refused.html).toContain(escaped(en("respond.full", { count: 300 })));
    const german = await respondViaUi(
      new ClientAt(test.app, "198.51.100.7", "de"),
      planId,
      "Zu viel",
      "joined",
    );
    expect(german.html).toContain(escaped(de("respond.full", { count: 300 })));
    expect(responseCount(test)).toBe(300);
  });
});

describe("web reports per plan (0.19.0)", () => {
  async function sendReport(client: TestClient, planId: string) {
    const form = hiddenFields(await (await client.get(`/p/${planId}/report`)).text());
    return client.postForm(`/p/${planId}/report`, { ...form, reason: "spam", details: "" });
  }

  it("accepts 10 an hour from any clients, then answers 429 without costing the client a token", async () => {
    const test = await createTestApp({
      env: { TRUST_PROXY: "true", ADMIN_TOKEN },
    });
    const { planId } = await createPlanViaUi(new ClientAt(test.app, "198.51.100.1"));
    for (let i = 0; i < 10; i++) {
      const sent = await sendReport(new ClientAt(test.app, `203.0.113.${i + 1}`), planId);
      expect(sent.status).toBe(303);
    }
    const late = new ClientAt(test.app, "203.0.113.99");
    const refused = await sendReport(late, planId);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused.text()).toContain(escaped(en("error.reportsBusy")));
    // The client's own burst of 3 is untouched: another plan can still be reported.
    const other = (await createPlanViaUi(new ClientAt(test.app, "198.51.100.2"))).planId;
    for (let i = 0; i < 3; i++) expect((await sendReport(late, other)).status).toBe(303);
    // Seven minutes on, the cap has refilled a token (10 an hour): the plan takes a report again.
    test.clock.advance({ minutes: 7 });
    expect((await sendReport(new ClientAt(test.app, "203.0.113.120"), planId)).status).toBe(303);
  });
});
