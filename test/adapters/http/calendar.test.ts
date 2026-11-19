// Calendar download and personal feed through the web pages (spec 6 feature 2, D18, I40).
import { describe, expect, it } from "vite-plus/test";
import { isSecretLinkPath } from "../../../src/adapters/in/http/routes/secret-links.tsx";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, planForm, respondViaUi } from "../../support/plans.ts";

const unfold = (text: string) => text.replaceAll("\r\n ", "");
const feedPath = (html: string) =>
  /https:\/\/runs\.example\.org(\/c\/[A-Za-z0-9_-]{43})/.exec(html)?.[1];

async function createFeed(client: TestClient) {
  const hidden = await client.hiddenFields("/calendar");
  const response = await client.postForm("/calendar", hidden);
  const html = await response.text();
  const path = feedPath(html);
  if (response.status !== 200 || path === undefined) {
    throw new Error(`feed creation failed: ${response.status} ${html.slice(0, 300)}`);
  }
  return { response, html, path };
}

describe("the calendar download (spec 6 feature 2)", () => {
  it("is an .ics file with the public details for viewers and the exact start for the host", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host);
    const response = await new TestClient(app).get(`/p/${planId}/calendar.ics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="plan.ics"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const ics = unfold(await response.text());
    expect(ics).toContain("SUMMARY:Easy Sunday run");
    expect(ics).toContain("LOCATION:Englischer Garten\\, north end");
    expect(ics).toContain("DTSTART:20260607T053000Z");
    expect(ics).toContain("DTEND:20260607T064500Z");
    expect(ics).toContain(`URL:https://runs.example.org/p/${planId}`);
    expect(ics).toContain("This plan will be deleted on");
    expect(ics).not.toContain("North gate");

    const hostIcs = unfold(await (await host.get(`/p/${planId}/calendar.ics`)).text());
    expect(hostIcs).toContain("LOCATION:North gate\\, by the bike racks");
    expect(hostIcs).toContain("GEO:48.16321;11.60147");
    expect(hostIcs).toContain("SUMMARY:Easy Sunday run (your plan)");
  });

  it("is linked from the plan page; the feed only for browsers still in a plan", async () => {
    const test = await createTestApp();
    const { app } = test;
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host);
    const viewerPage = await (await new TestClient(app).get(`/p/${planId}`)).text();
    expect(viewerPage).toContain(`href="/p/${planId}/calendar.ics"`);
    // The plan page's own button; the site menu links the feed page everywhere.
    const feedButton = /<a class="button[^"]*" href="\/calendar"/;
    expect(viewerPage).not.toMatch(feedButton);
    expect(await (await host.get(`/p/${planId}`)).text()).toMatch(feedButton);
    const removed = new TestClient(app);
    await respondViaUi(removed, planId, "Rex", "joined");
    test.database.sqlite.prepare("update responses set kind = 'removed'").run();
    expect(await (await removed.get(`/p/${planId}`)).text()).not.toMatch(feedButton);
  });

  it("is 404 for unknown plans", async () => {
    const { app } = await createTestApp();
    expect((await app.request("/p/unknown/calendar.ics")).status).toBe(404);
  });
});

describe("the calendar feed page (spec 6 feature 2)", () => {
  it("shows the feed link once, as webcal and https, and says when an unused browser expires", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    await createPlanViaUi(host);
    const page = await (await host.get("/calendar")).text();
    expect(page).toContain('action="/calendar"');
    expect(feedPath(page)).toBeUndefined();

    const { response, html, path } = await createFeed(host);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(html).toContain(`href="webcal://runs.example.org${path}"`);
    expect(html).toContain("Updates in your calendar don’t count");

    const later = await (await host.get("/calendar")).text();
    expect(feedPath(later)).toBeUndefined();
    expect(later).toContain("This browser has a calendar link.");
    expect(later).toContain("for 365 days");
  });

  it("is only for browsers with plans, and creates no device (spec 3.10)", async () => {
    const { app } = await createTestApp();
    const client = new TestClient(app);
    const page = await (await client.get("/calendar")).text();
    expect(page).toContain("Create a plan or respond to one in this browser first.");
    expect(page).not.toContain('action="/calendar"');
    const hidden = hiddenFields(page);
    const response = await client.postForm("/calendar", hidden);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/calendar");
    expect(response.headers.getSetCookie().join()).not.toMatch(/rr-device=/);
  });

  it("limits how often a browser creates links (decision I32)", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    await createPlanViaUi(host);
    const hidden = await host.hiddenFields("/calendar");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await host.postForm("/calendar", hidden)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("needs the CSRF token", async () => {
    const { app } = await createTestApp();
    const client = new TestClient(app);
    expect((await client.postForm("/calendar", {})).status).toBe(403);
    expect((await client.postForm("/calendar/stop", {})).status).toBe(403);
  });

  it("can replace or stop the link", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    await createPlanViaUi(host);
    const first = await createFeed(host);
    const second = await createFeed(host);
    expect((await host.get(first.path)).status).toBe(404);
    expect((await host.get(second.path)).status).toBe(200);
    const hidden = hiddenFields(await (await host.get("/calendar")).text());
    expect((await host.postForm("/calendar/stop", hidden)).status).toBe(303);
    expect((await host.get(second.path)).status).toBe(404);
  });
});

describe("the calendar feed (spec 6 feature 2)", () => {
  it("lists the browser's plans with public details, deletion entries and no cookies", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host);
    const { path } = await createFeed(host);
    const response = await new TestClient(app).get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.getSetCookie()).toEqual([]);
    const ics = unfold(await response.text());
    expect(ics).toContain("X-WR-CALNAME:RendezRoute");
    expect(ics).toContain("SUMMARY:Easy Sunday run (your plan)");
    expect(ics).toContain("LOCATION:Englischer Garten\\, north end");
    expect(ics).toContain(`UID:${planId}-deletion@runs.example.org`);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260621");
    expect(ics).toContain("SUMMARY:“Easy Sunday run” will be deleted today");
    expect(ics).not.toContain("North gate");
    expect(ics).not.toContain("GEO:");
  });

  it("is written in the language of the browser that created it", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    await createPlanViaUi(host);
    const hidden = await host.hiddenFields("/calendar");
    const html = await (
      await host.request("/calendar", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "accept-language": "de",
        },
        body: new URLSearchParams(hidden).toString(),
      })
    ).text();
    const ics = unfold(await (await app.request(feedPath(html) ?? "")).text());
    expect(ics).toContain("SUMMARY:Easy Sunday run (dein Treffen)");
  });

  it("is 404 for unknown links, and its path is never echoed elsewhere (spec 3.2)", async () => {
    const { app } = await createTestApp();
    expect((await app.request(`/c/${"x".repeat(43)}`)).status).toBe(404);
    expect(isSecretLinkPath("/c/abc")).toBe(true);
    expect(isSecretLinkPath("/calendar")).toBe(false);
  });

  it("reflects changes, cancellations and deletions on the next poll (acceptance criterion)", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const kept = await createPlanViaUi(host, { title: "Morning run" });
    const dropped = await createPlanViaUi(host, { title: "Evening ride" });
    const ben = new TestClient(app);
    const joined = await createPlanViaUi(new TestClient(app), { title: "Lake loop" });
    await respondViaUi(ben, joined.planId, "Ben", "joined");
    const hostFeed = (await createFeed(host)).path;
    const benFeed = (await createFeed(ben)).path;
    const poll = async (path: string) => unfold(await (await app.request(path)).text());
    expect(await poll(benFeed)).toContain("SUMMARY:Lake loop");

    const edit = await host.hiddenFields(`/p/${kept.planId}/host`);
    await host.postForm(`/p/${kept.planId}/host`, {
      ...edit,
      ...planForm({ title: "Long morning run" }),
    });
    await host.postForm(`/p/${kept.planId}/host/cancel`, edit);
    await host.postForm(`/p/${dropped.planId}/host/delete`, edit);
    const after = await poll(hostFeed);
    expect(after).toContain("SUMMARY:Cancelled: Long morning run (your plan)");
    expect(after).toContain("STATUS:CANCELLED");
    expect(after).not.toContain("Evening ride");
  });
});
