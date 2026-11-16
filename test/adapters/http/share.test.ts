import { describe, expect, it } from "vite-plus/test";
import { sampleGpx } from "../../support/gpx.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, createPlanWithRouteViaUi } from "../../support/plans.ts";

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const created = await createPlanViaUi(host, { title: "Easy & early" });
  return { ...test, host, ...created };
}

const shareSection = (html: string) =>
  /<section class="share"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

describe("share helpers (spec 5 feature 4)", () => {
  it("offer a WhatsApp link with the plan's address, which works without JavaScript, and no X link (decision D41)", async () => {
    const { host, planId } = await setup();
    const share = shareSection(await (await host.get(`/p/${planId}`)).text());
    const url = `https://runs.example.org/p/${planId}`;
    expect(share).toContain(
      `href="https://wa.me/?text=${encodeURIComponent(`Easy & early ${url}`)}"`.replaceAll(
        "&",
        "&amp;",
      ),
    );
    expect(share).not.toContain("x.com");
    expect(share).toContain('rel="noopener noreferrer"');
    // Marked, so the script can hide it where the device's share sheet offers the app.
    expect(share.match(/<a class="button secondary" data-share-app=""/g)).toHaveLength(1);
  });

  it("add copy and Web Share buttons that only the script reveals", async () => {
    const { host, planId } = await setup();
    const share = shareSection(await (await host.get(`/p/${planId}`)).text());
    expect(share).toContain(`data-url="https://runs.example.org/p/${planId}"`);
    expect(share).toMatch(/<button[^>]*data-share-copy=""[^>]*hidden=""/);
    expect(share).toMatch(/<button[^>]*data-share-native=""[^>]*hidden=""/);
  });

  it("are on the links page right after creating, and for viewers", async () => {
    const { html, planId, app } = await setup();
    expect(shareSection(html)).toContain(`data-url="https://runs.example.org/p/${planId}"`);
    const viewer = await (await new TestClient(app).get(`/p/${planId}`)).text();
    expect(shareSection(viewer)).not.toBe("");
  });

  it("come last on the plan page, after the route section and the plan-side block (decision D69)", async () => {
    const { app, host } = await setup();
    const { planId } = await createPlanWithRouteViaUi(host, { title: "Routed" }, sampleGpx());
    const hostHtml = await (await host.get(`/p/${planId}`)).text();
    const viewerHtml = await (await new TestClient(app).get(`/p/${planId}`)).text();
    const at = (html: string, marker: string) => html.indexOf(marker);
    expect(at(hostHtml, '<section class="route">')).toBeGreaterThan(-1);
    for (const html of [hostHtml, viewerHtml]) {
      const share = at(html, '<section class="share"');
      expect(share).toBeGreaterThan(-1);
      expect(share).toBeGreaterThan(at(html, '<div class="plan-side">'));
      expect(html.match(/<section class="share"/g)).toHaveLength(1);
      // No section of the page content follows it.
      expect(html.slice(share)).not.toMatch(/<section class="(?:route|people|weather)"/);
      expect(html.slice(share)).not.toContain('class="plan-after"');
    }
    expect(at(hostHtml, '<section class="share"')).toBeGreaterThan(
      at(hostHtml, '<section class="route">'),
    );
  });

  it("are gone once the plan is cancelled", async () => {
    const { host, planId } = await setup();
    const page = await (await host.get(`/p/${planId}/host`)).text();
    await host.postForm(`/p/${planId}/host/cancel`, hiddenFields(page));
    expect(shareSection(await (await host.get(`/p/${planId}`)).text())).toBe("");
  });

  it("never share the host link", async () => {
    const { html, hostPath } = await setup();
    expect(shareSection(html)).not.toContain(hostPath);
  });
});

describe("share buttons chosen by the host (decision D41)", () => {
  const ticked = (html: string, name: string) =>
    new RegExp(`<input[^>]*name="${name}"[^>]*checked`).test(html);

  it("are all offered on a new plan, and only those chosen are shown", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const form = await (await host.get("/new")).text();
    for (const name of ["shareCopy", "shareNative", "shareWhatsApp"]) {
      expect(ticked(form, name)).toBe(true);
    }
    const { planId, html } = await createPlanViaUi(host, {
      shareNative: "",
      shareWhatsApp: "",
    });
    for (const page of [html, await (await host.get(`/p/${planId}`)).text()]) {
      const share = shareSection(page);
      expect(share).toContain("data-share-copy");
      expect(share).not.toContain("data-share-native");
      expect(share).not.toContain("wa.me");
    }
    // The host page shows the choice as it is stored.
    const hostPage = await (await host.get(`/p/${planId}/host`)).text();
    expect(ticked(hostPage, "shareCopy")).toBe(true);
    expect(ticked(hostPage, "shareWhatsApp")).toBe(false);
  });

  it("keep the section hidden when only buttons that need JavaScript are chosen (decision D41)", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const only = (overrides: Record<string, string>) =>
      createPlanViaUi(host, { shareCopy: "", shareNative: "", shareWhatsApp: "", ...overrides });
    for (const choice of [
      { shareCopy: "1" },
      { shareNative: "1" },
      { shareCopy: "1", shareNative: "1" },
    ]) {
      const { planId, html } = await only(choice);
      for (const page of [html, await (await host.get(`/p/${planId}`)).text()]) {
        expect(shareSection(page)).toMatch(/^<section [^>]*\bhidden=""/);
      }
    }
    // The WhatsApp link works without JavaScript, so its section shows.
    const { html } = await only({ shareWhatsApp: "1", shareCopy: "1" });
    expect(shareSection(html)).not.toMatch(/^<section [^>]*\bhidden/);
  });

  it("can all be turned off, leaving no share section", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {
      shareCopy: "",
      shareNative: "",
      shareWhatsApp: "",
    });
    expect(shareSection(await (await host.get(`/p/${planId}`)).text())).toBe("");
  });
});

describe("time zones in the browser (decision P6)", () => {
  it("mark the plan's zone label so the script can hide it for viewers in that zone", async () => {
    const { host, planId } = await setup();
    const page = await (await host.get(`/p/${planId}`)).text();
    expect(page).toMatch(/<span class="time-zone" data-time-zone="Europe\/Berlin">/);
  });

  it("let the script pick the poster's zone on the create form only", async () => {
    const { host, planId } = await setup();
    expect(await (await host.get("/new")).text()).toMatch(
      /<select[^>]*name="timeZone"[^>]*data-detect-zone="UTC"/,
    );
    expect(await (await host.get(`/p/${planId}/host`)).text()).not.toContain("data-detect-zone");
  });
});

describe("app script (spec 2: small scripts only where needed)", () => {
  it("is loaded from this site on every page, as a module of its own scope", async () => {
    const { host, planId } = await setup();
    for (const path of ["/", "/new", `/p/${planId}`]) {
      expect(await (await host.get(path)).text()).toContain(
        '<script src="/static/build/app.js" type="module"></script>',
      );
    }
  });
});
