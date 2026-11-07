import { describe, expect, it } from "vite-plus/test";
import { en } from "../../../src/adapters/i18n/messages/en.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, planForm } from "../../support/plans.ts";

const DEVICE_COOKIE = "__Host-rr-device";

async function setup() {
  const test = await createTestApp();
  return { ...test, client: new TestClient(test.app) };
}

describe("GET /new (spec 5 feature 1)", () => {
  it("renders the form with CSRF token and a one-time nonce, without creating a device (decision P2)", async () => {
    const { client } = await setup();
    const response = await client.get("/new");
    const html = await response.text();
    expect(response.status).toBe(200);
    const hidden = hiddenFields(html);
    expect(hidden._csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hidden.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    for (const name of [
      "posterName",
      "activity",
      "title",
      "date",
      "time",
      "timeZone",
      "areaLabel",
      "exactDescription",
      "retentionDays",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(client.cookies.has(DEVICE_COOKIE)).toBe(false);
  });

  it("preselects DEFAULT_TIMEZONE and the default retention", async () => {
    const { client } = await setup();
    const html = await (await client.get("/new")).text();
    expect(html).toMatch(/<option value="UTC" selected="">/);
    expect(html).toMatch(/<option value="14" selected="">/);
  });

  it("warns that public fields must not contain the exact meeting point (decision D2)", async () => {
    const { client } = await setup();
    expect(await (await client.get("/new")).text()).toContain(escaped(en["form.publicHint"]));
  });
});

describe("POST /new", () => {
  it("shows the links once, with no-store and no-referrer, and sets a secure device cookie", async () => {
    const { client } = await setup();
    const { response, html, hostPath, planId } = await createPlanViaUi(client);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(html).toContain(`https://runs.example.org${hostPath}`);
    expect(html).toContain(`https://runs.example.org/p/${planId}`);
    const cookie =
      response.headers.getSetCookie().find((c) => c.startsWith(`${DEVICE_COOKIE}=`)) ?? "";
    expect(cookie).toMatch(/^__Host-rr-device=[A-Za-z0-9_-]{43};/);
    for (const attribute of ["Max-Age=34560000", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) {
      expect(cookie).toContain(attribute);
    }
  });

  it("redirects a resubmitted form to the existing plan instead of creating another (decision I9)", async () => {
    const { client } = await setup();
    const { hidden, planId } = await createPlanViaUi(client);
    const again = await client.postForm("/new", { ...hidden, ...planForm() });
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe(`/p/${planId}`);
  });

  it("re-renders the form with errors and the entered values, without a device cookie", async () => {
    const { client } = await setup();
    const hidden = await client.hiddenFields("/new");
    const response = await client.postForm("/new", {
      ...hidden,
      ...planForm({ title: "", posterName: "Anna <b>" }),
    });
    const html = await response.text();
    expect(response.status).toBe(422);
    expect(html).toContain(escaped(en["field.required"]));
    expect(html).toContain('value="Anna &lt;b&gt;"');
    expect(client.cookies.has(DEVICE_COOKIE)).toBe(false);
  });

  it("rejects oversized request bodies before parsing them", async () => {
    const { client } = await setup();
    const hidden = await client.hiddenFields("/new");
    const response = await client.postForm("/new", {
      ...hidden,
      ...planForm({ note: "x".repeat(200_000) }),
    });
    expect(response.status).toBe(413);
  });

  it("answers malformed form bodies with 400, not an internal error", async () => {
    const { client, logs } = await setup();
    const hidden = await client.hiddenFields("/new");
    const response = await client.request("/new", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=xyz",
        "x-csrf-token": hidden._csrf ?? "",
      },
      body: "garbage without boundary markers",
    });
    expect(response.status).toBe(400);
    expect(logs.join("\n")).not.toContain("unhandled_error");
  });

  it("uses a non-__Host device cookie without Secure in development mode", async () => {
    const test = await createTestApp({
      env: { BASE_URL: "http://localhost:3000", ALLOW_INSECURE_DEV: "true" },
    });
    const client = new TestClient(test.app);
    const hidden = await client.hiddenFields("/new");
    const response = await client.postForm("/new", { ...hidden, ...planForm() });
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("rr-device=")) ?? "";
    expect(cookie).toMatch(/^rr-device=[A-Za-z0-9_-]{43};/);
    expect(cookie).not.toContain("Secure");
  });

  it("rejects submissions without a CSRF token (spec 3.8)", async () => {
    const { client } = await setup();
    const response = await client.postForm("/new", {
      nonce: "nonce-aaaaaaaaaaaaaaaa",
      ...planForm(),
    });
    expect(response.status).toBe(403);
  });
});

describe("GET /p/:id (spec 5 feature 3)", () => {
  it("shows the host the exact start and plain viewers only the public details", async () => {
    const { app, client } = await setup();
    const { planId } = await createPlanViaUi(client);

    const hostHtml = await (await client.get(`/p/${planId}`)).text();
    expect(hostHtml).toContain("North gate, by the bike racks");
    expect(hostHtml).toContain("geo:48.16321,11.60147");

    const viewerHtml = await (await new TestClient(app).get(`/p/${planId}`)).text();
    expect(viewerHtml).toContain("Easy Sunday run");
    expect(viewerHtml).toContain("Englischer Garten, north end");
    expect(viewerHtml).not.toContain("North gate");
    expect(viewerHtml).not.toContain("48.16321");
  });

  it("shows time in the plan's time zone with its label, and the deletion date", async () => {
    const { client } = await setup();
    const { planId } = await createPlanViaUi(client);
    const html = await (await client.get(`/p/${planId}`)).text();
    expect(html).toContain("07:30");
    expect(html).toContain("Europe/Berlin");
    expect(html).toContain("21 June 2026");
  });

  it("is not cached by shared caches, since it differs per device", async () => {
    const { client } = await setup();
    const { planId } = await createPlanViaUi(client);
    expect((await client.get(`/p/${planId}`)).headers.get("cache-control")).toBe(
      "private, no-cache",
    );
  });

  it("answers unknown IDs with 404 'This plan no longer exists' (decision P4)", async () => {
    const { client } = await setup();
    const response = await client.get("/p/AAAAAAAAAAAAAAAAAAAAAA");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain(escaped(en["plan.gone"]));
  });

  it("renders user text inert and links only http(s) URLs (spec 3.8)", async () => {
    const { client } = await setup();
    const { planId } = await createPlanViaUi(client, {
      title: "<script>alert(1)</script>",
      note: "Route: https://example.org/route?a=1&b=2. Not this: javascript:alert(1)",
    });
    const html = await (await client.get(`/p/${planId}`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain(
      '<a href="https://example.org/route?a=1&amp;b=2" rel="noopener noreferrer nofollow ugc">',
    );
    expect(html).not.toMatch(/href="javascript:/);
  });
});

describe("host link (spec 3.2, decision D1)", () => {
  it("asks for confirmation on a new device, without state change, no-referrer, no-store and noindex", async () => {
    const { app, client } = await setup();
    const { hostPath } = await createPlanViaUi(client);
    const other = new TestClient(app);
    const response = await other.get(hostPath);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain(
      `<meta property="og:title" content="${escaped(en["hostLink.ogTitle"])}"`,
    );
    expect(other.cookies.has(DEVICE_COOKIE)).toBe(false);
  });

  it("links the device on confirmation and redirects to the token-free plan URL", async () => {
    const { app, client } = await setup();
    const { hostPath, planId } = await createPlanViaUi(client);
    const other = new TestClient(app);
    const hidden = await other.hiddenFields(hostPath);
    const confirmed = await other.postForm("/a", hidden);
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.get("location")).toBe(`/p/${planId}`);
    expect(confirmed.headers.get("referrer-policy")).toBe("no-referrer");
    expect(other.cookies.has(DEVICE_COOKIE)).toBe(true);
    expect(await (await other.get(`/p/${planId}`)).text()).toContain("North gate");
  });

  it("redirects an already linked device directly", async () => {
    const { client } = await setup();
    const { hostPath, planId } = await createPlanViaUi(client);
    const response = await client.get(hostPath);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/p/${planId}`);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects unknown tokens", async () => {
    const { client } = await setup();
    expect((await client.get(`/a/${"x".repeat(43)}`)).status).toBe(404);
  });
});

describe("static assets (spec 2: served by the instance, never from a CDN)", () => {
  it("serves the bundled stylesheet with caching and the security headers", async () => {
    const { client } = await setup();
    const response = await client.get("/static/app.css");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not serve files outside the public directory", async () => {
    const { client } = await setup();
    for (const path of [
      "/static/../package.json",
      "/static/%2e%2e/package.json",
      "/static/missing.css",
    ]) {
      expect((await client.get(path)).status).toBe(404);
    }
  });
});
