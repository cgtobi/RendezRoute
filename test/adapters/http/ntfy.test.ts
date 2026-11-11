// ntfy through the pages (spec 7 Optional notification channels, decision D33): set up in the
// "More ways to be notified" fold, confirmed by the posted link, turned off from every message.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const NTFY = { NTFY_URL: "https://ntfy.example.org" };

async function setup(env: Record<string, string> = NTFY) {
  const test = await createTestApp({ env });
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "Ben", "joined");
  return { ...test, host, ben, planId };
}

async function post(client: TestClient, page: string, action: string) {
  const hidden = await client.hiddenFields(page);
  return client.postForm(action, { _csrf: hidden._csrf ?? "" });
}

/** The path of the link the last ntfy message carries. */
function lastLink(client: { published: { click?: string | undefined }[] }): string {
  const click = client.published.at(-1)?.click ?? "";
  return new URL(click).pathname;
}

describe("ntfy on the manage and host pages (decision D33)", () => {
  it("is offered in a closed fold only when NTFY_URL is set", async () => {
    const without = await setup({});
    expect(await (await without.ben.get(`/p/${without.planId}/me`)).text()).not.toContain(
      escaped(en("channels.more")),
    );
    const { ben, host, planId } = await setup();
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).toContain('<details class="more-channels">');
    expect(page).toContain(escaped(en("ntfy.hint", { server: "ntfy.example.org" })));
    expect(await (await host.get(`/p/${planId}/host`)).text()).toContain(
      `action="/p/${planId}/host/ntfy"`,
    );
  });

  it("shows the secret topic, posts the confirmation link, and nothing else until it is used", async () => {
    const { ben, host, planId, ntfyClient, runJobs } = await setup();
    const set = await post(ben, `/p/${planId}/me`, `/p/${planId}/me/ntfy`);
    expect(set.status).toBe(303);
    expect(set.headers.get("location")).toBe(`/p/${planId}/me#ntfy`);
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).toContain('<details class="more-channels" open="">');
    const topicUrl = /<code>(https:\/\/ntfy\.example\.org\/[A-Za-z0-9_-]{43})<\/code>/.exec(
      page,
    )?.[1];
    expect(topicUrl).toBeDefined();
    await runJobs();
    expect(ntfyClient.published.map((message) => message.topic)).toEqual([
      topicUrl?.split("/").pop(),
    ]);
    expect(ntfyClient.published[0]?.click).toMatch(/^https:\/\/runs\.example\.org\/e\//);

    await host.postForm(`/p/${planId}/host/cancel`, await host.hiddenFields(`/p/${planId}/host`));
    await runJobs();
    expect(ntfyClient.published).toHaveLength(1);
  });

  it("is confirmed on the link's page, then notifications come with a button to turn it off", async () => {
    const { app, ben, host, planId, ntfyClient, runJobs } = await setup();
    await post(ben, `/p/${planId}/me`, `/p/${planId}/me/ntfy`);
    await runJobs();
    const link = lastLink(ntfyClient);
    const phone = new TestClient(app);
    const page = await (await phone.get(link)).text();
    expect(page).toContain(escaped(en("ntfyLink.confirmHeading")));
    const confirmed = await phone.postForm("/e", { ...hiddenFields(page), action: "confirm" });
    expect(await confirmed.text()).toContain(escaped(en("ntfyLink.confirmed")));
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(escaped(en("ntfy.on")));

    await host.postForm(`/p/${planId}/host/cancel`, await host.hiddenFields(`/p/${planId}/host`));
    await runJobs();
    const message = ntfyClient.published.at(-1);
    expect(message?.message).toContain(en("notify.cancelled"));
    expect(message?.actions?.[0]?.url).toBe(`https://runs.example.org${link}`);

    const off = await phone.postForm("/e", {
      ...hiddenFields(await (await phone.get(link)).text()),
      action: "off",
    });
    expect(await off.text()).toContain(escaped(en("ntfyLink.turnedOff")));
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(
      '<details class="more-channels">',
    );
  });

  it("is turned off from the page", async () => {
    const { host, ben, planId } = await setup();
    await post(host, `/p/${planId}/host`, `/p/${planId}/host/ntfy`);
    const page = await (await host.get(`/p/${planId}/host`)).text();
    expect(page).toContain(escaped(en("ntfy.pending")));
    // Co-hosts see the plan's topic too; a response's topic is its owner's alone.
    expect(page).toContain(escaped(en("ntfy.hostShared")));
    await post(ben, `/p/${planId}/me`, `/p/${planId}/me/ntfy`);
    expect(await (await ben.get(`/p/${planId}/me`)).text()).not.toContain(
      escaped(en("ntfy.hostShared")),
    );
    await post(host, `/p/${planId}/host`, `/p/${planId}/host/ntfy/off`);
    expect(await (await host.get(`/p/${planId}/host`)).text()).not.toContain(
      escaped(en("ntfy.pending")),
    );
  });

  it("gives the attempt back when nothing was posted", async () => {
    const { ben, planId, ntfyClient, runJobs } = await setup();
    await post(ben, `/p/${planId}/me`, `/p/${planId}/me/ntfy`);
    await runJobs();
    const link = lastLink(ntfyClient);
    await ben.postForm("/e", { ...(await ben.hiddenFields(link)), action: "confirm" });
    // Already on: each request changes nothing and posts nothing.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      statuses.push((await post(ben, `/p/${planId}/me`, `/p/${planId}/me/ntfy`)).status);
    }
    expect(statuses.every((status) => status === 303)).toBe(true);
  });

  it("counts each setup against the notification limit (spec 3.11)", async () => {
    const { ben, planId } = await setup();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      statuses.push((await post(ben, `/p/${planId}/me`, `/p/${planId}/me/ntfy`)).status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("a link that no longer works", () => {
  it("says so without naming a kind of channel", async () => {
    const { app } = await setup();
    const page = await app.request("/e/made-up_s_token");
    expect(page.status).toBe(404);
    expect(await page.text()).toContain(escaped(en("channelLink.invalid")));
  });
});

describe("privacy notice", () => {
  it("names the ntfy server when ntfy is configured", async () => {
    const withNtfy = await createTestApp({ env: NTFY });
    const text = (html: string) => html.replaceAll("&#39;", "'");
    expect(text(await (await withNtfy.app.request("/privacy")).text())).toContain(
      en("privacy.ntfy", { server: "ntfy.example.org" }),
    );
    const without = await createTestApp();
    expect(text(await (await without.app.request("/privacy")).text())).not.toContain("ntfy");
  });
});
