// "Notify me about this plan" through the web pages (spec 6 feature 3, decision D17).
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  expirationTime: null,
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
};

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "Ben", "joined");
  return { ...test, host, ben, planId };
}

async function call(client: TestClient, path: string, body: unknown, { csrf = true } = {}) {
  const token = (await client.hiddenFields("/new"))._csrf ?? "";
  return client.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": token } : {}) },
    body: JSON.stringify(body),
  });
}

const widget = (html: string) => /<div[^>]*data-push=""[^>]*>/.exec(html)?.[0] ?? "";

describe("the notification switch (decision D17)", () => {
  it("is on the manage page and the host page, hidden until the script finds push support", async () => {
    const { host, ben, planId, vapidPublicKey } = await setup();
    const manage = widget(await (await ben.get(`/p/${planId}/me`)).text());
    expect(manage).toContain(`data-endpoint="/p/${planId}/me/notifications"`);
    expect(manage).toContain(`data-vapid-key="${vapidPublicKey}"`);
    expect(manage).toContain('hidden=""');
    const hostPage = widget(await (await host.get(`/p/${planId}/host`)).text());
    expect(hostPage).toContain(`data-endpoint="/p/${planId}/host/notifications"`);
  });

  it("only lets removed people turn notifications off (spec 3.5)", async () => {
    const { host, ben, planId } = await setup();
    const page = await (await host.get(`/p/${planId}/host`)).text();
    const remove = /<form[^>]*action="([^"]+\/remove)"[\s\S]*?<\/form>/.exec(page);
    await host.postForm(remove?.[1] ?? "", hiddenFields(remove?.[0] ?? ""));
    expect(widget(await (await ben.get(`/p/${planId}/me`)).text())).toContain('data-off-only=""');
    expect(widget(await (await host.get(`/p/${planId}/host`)).text())).not.toContain("off-only");
  });
});

describe("notification endpoints (spec 6 feature 3)", () => {
  it("subscribe, report and unsubscribe this browser", async () => {
    const { ben, planId, channels } = await setup();
    const base = `/p/${planId}/me/notifications`;
    const on = await call(ben, base, { subscription });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ enabled: true });
    expect(on.headers.get("cache-control")).toBe("no-store");
    expect(
      await (await call(ben, `${base}/status`, { endpoint: subscription.endpoint })).json(),
    ).toEqual({
      enabled: true,
    });
    expect(await channels.listFor({ responseId: "x" })).toEqual([]);
    expect(
      await (await call(ben, `${base}/off`, { endpoint: subscription.endpoint })).json(),
    ).toEqual({
      enabled: false,
    });
  });

  it("work for the host on the host page's endpoint only", async () => {
    const { host, ben, planId } = await setup();
    expect((await call(host, `/p/${planId}/host/notifications`, { subscription })).status).toBe(
      200,
    );
    expect((await call(ben, `/p/${planId}/host/notifications`, { subscription })).status).toBe(403);
    expect(
      (
        await call(new TestClient((await setup()).app), `/p/${planId}/me/notifications`, {
          subscription,
        })
      ).status,
    ).toBe(404);
  });

  it("need the CSRF token and refuse endpoints outside the push services", async () => {
    const { ben, planId } = await setup();
    const base = `/p/${planId}/me/notifications`;
    expect((await call(ben, base, { subscription }, { csrf: false })).status).toBe(403);
    const foreign = { ...subscription, endpoint: "https://evil.example/collect" };
    expect((await call(ben, base, { subscription: foreign })).status).toBe(400);
    expect((await call(ben, `${base}/status`, "nonsense")).status).toBe(400);
  });
});

describe("deleting an upcoming plan (spec 3.10)", () => {
  it("leaves only its standalone notification jobs, which expire within 24 hours", async () => {
    const { app, host, ben, planId, database, clock } = await setup();
    await call(ben, `/p/${planId}/me/notifications`, { subscription });
    await call(host, `/p/${planId}/host/notifications`, { subscription });
    // A notice for the host, tied to the plan, is still waiting.
    await respondViaUi(new TestClient(app), planId, "Ida", "joined");
    const jobs = () =>
      database.sqlite
        .prepare("select plan_id, response_id, expires_at, payload_enc from job_queue")
        .all() as { plan_id: string | null; response_id: string | null; expires_at: string }[];
    expect(jobs().some((job) => job.plan_id === planId)).toBe(true);

    const csrf = (await host.hiddenFields(`/p/${planId}/host/delete`))._csrf ?? "";
    await host.postForm(`/p/${planId}/host/delete`, { _csrf: csrf });

    const left = jobs();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      plan_id: null,
      response_id: null,
      expires_at: new Date(clock.now().getTime() + 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(JSON.stringify(left)).not.toContain("fcm.googleapis.com");
  });
});

describe("abuse limits on notifications (spec 3.11)", () => {
  it("refuse a burst of subscriptions from one client", async () => {
    const { ben, planId } = await setup();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await call(ben, `/p/${planId}/me/notifications`, { subscription })).status);
    }
    expect(statuses).toEqual([...Array<number>(10).fill(200), 429]);
  });

  it("count switches to joined on the manage page like new responses, so the host is not flooded", async () => {
    const { ben, planId } = await setup();
    const hidden = hiddenFields(await (await ben.get(`/p/${planId}/me`)).text());
    const change = (choice: string, displayName = "Ben") =>
      ben.postForm(`/p/${planId}/me`, { ...hidden, displayName, choice });
    let joins = 0;
    for (let round = 0; round < 40; round++) {
      expect((await change("interested")).status).toBe(303);
      const joined = await change("joined");
      if (joined.status === 429) break;
      expect(joined.status).toBe(303);
      joins += 1;
    }
    // Responding took one token of the burst of 30.
    expect(joins).toBe(29);
    expect((await change("interested", "Benjamin")).status).toBe(303);
  });
});

describe("the service worker", () => {
  it("is served from the site root, so it can show this site's notifications", async () => {
    const { app } = await createTestApp();
    const response = await app.request("/sw.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toContain("showNotification");
  });
});
