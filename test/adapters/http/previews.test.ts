import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { sampleGpx } from "../../support/gpx.ts";
import { createPlanViaUi, planForm } from "../../support/plans.ts";

async function setup() {
  const test = await createTestApp({ env: { INSTANCE_NAME: "Isar Runners" } });
  const host = new TestClient(test.app);
  const hidden = await host.hiddenFields("/new");
  const created = await host.postMultipart(
    "/new",
    { ...hidden, ...planForm({ exactDescription: "SENTINEL north gate" }) },
    { gpx: { name: "run.gpx", content: sampleGpx() } },
  );
  const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(await created.text())?.[1] ?? "";
  return { ...test, host, planId, newClient: () => new TestClient(test.app) };
}

const head = (html: string) => /<head>[\s\S]*<\/head>/.exec(html)?.[0] ?? "";
const meta = (html: string, key: string) =>
  new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];

describe("Open Graph tags (spec 5 feature 3)", () => {
  it("describe the plan with public details and a versioned card image", async () => {
    const { planId, newClient } = await setup();
    const html = await (await newClient().get(`/p/${planId}`)).text();
    expect(meta(html, "og:type")).toBe("website");
    expect(meta(html, "og:site_name")).toBe("Isar Runners");
    expect(meta(html, "og:title")).toBe("Easy Sunday run");
    expect(meta(html, "og:url")).toBe(`https://runs.example.org/p/${planId}`);
    expect(meta(html, "og:description")).toContain("Englischer Garten, north end");
    expect(meta(html, "og:description")).toContain("07:30");
    expect(meta(html, "og:image")).toMatch(
      new RegExp(`^https://runs\\.example\\.org/p/${planId}/og\\.png\\?v=[a-z0-9]+$`),
    );
    expect(meta(html, "og:image:width")).toBe("1200");
    expect(meta(html, "og:image:height")).toBe("630");
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
  });

  it("are the same for the host and never contain the exact start or route (spec 2b)", async () => {
    const { host, planId, newClient } = await setup();
    const hostHead = head(await (await host.get(`/p/${planId}`)).text());
    const viewerHead = head(await (await newClient().get(`/p/${planId}`)).text());
    const tags = (h: string) => h.match(/<meta (?:property|name)="(?:og|twitter):[^>]*>/g);
    expect(tags(hostHead)).toEqual(tags(viewerHead));
    for (const forbidden of ["SENTINEL", "48.16321", "11.60147", "47.12345", "10.98765"]) {
      expect(hostHead).not.toContain(forbidden);
    }
  });

  it("mark cancelled plans", async () => {
    const { host, planId, clock } = await setup();
    const csrf = (await host.hiddenFields(`/p/${planId}/host`))._csrf ?? "";
    clock.set("2026-06-02T08:00:00Z");
    await host.postForm(`/p/${planId}/host/cancel`, { _csrf: csrf });
    const html = await (await host.get(`/p/${planId}`)).text();
    expect(meta(html, "og:title")).toBe("Cancelled: Easy Sunday run");
  });
});

describe("GET /p/:id/og.png", () => {
  it("serves the rendered card, cached until the plan changes", async () => {
    const { planId, newClient, previewRenderer } = await setup();
    const client = newClient();
    const response = await client.get(`/p/${planId}/og.png?v=anything`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toContain("Easy Sunday run");
    await client.get(`/p/${planId}/og.png`);
    expect(previewRenderer.rendered).toHaveLength(1);
    expect(JSON.stringify(previewRenderer.rendered)).not.toContain("SENTINEL");
  });

  it("answers 404 for unknown plans and 503 while rendering is busy", async () => {
    const { planId, newClient, previewRenderer } = await setup();
    expect((await newClient().get("/p/AAAAAAAAAAAAAAAAAAAAAA/og.png")).status).toBe(404);
    previewRenderer.busy = true;
    const busy = await newClient().get(`/p/${planId}/og.png`);
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("5");
  });

  it("is gone once the plan is deleted (P4)", async () => {
    const { host, planId } = await setup();
    await host.get(`/p/${planId}/og.png`);
    const csrf = (await host.hiddenFields(`/p/${planId}/host/delete`))._csrf ?? "";
    await host.postForm(`/p/${planId}/host/delete`, { _csrf: csrf });
    expect((await host.get(`/p/${planId}/og.png`)).status).toBe(404);
  });
});

describe("plans created without a route", () => {
  it("still get tags", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    expect(meta(await (await host.get(`/p/${planId}`)).text(), "og:title")).toBe("Easy Sunday run");
  });
});
