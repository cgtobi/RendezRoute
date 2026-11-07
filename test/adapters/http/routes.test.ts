import { describe, expect, it } from "vite-plus/test";
import { en } from "../../../src/adapters/i18n/messages/en.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { sampleGpx } from "../../support/gpx.ts";
import { escaped } from "../../support/html.ts";
import { planForm, respondViaUi } from "../../support/plans.ts";

const noExactPoint = { exactLat: "", exactLng: "", distanceKm: "" };

async function createWithGpx(
  client: TestClient,
  gpx: string | Uint8Array,
  overrides: Record<string, string> = noExactPoint,
) {
  const hidden = await client.hiddenFields("/new");
  return client.postMultipart(
    "/new",
    { ...hidden, ...planForm(overrides) },
    { gpx: { name: "run.gpx", content: gpx } },
  );
}

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const created = await createWithGpx(host, sampleGpx());
  const html = await created.text();
  const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(html)?.[1] ?? "";
  return { ...test, host, planId, created, newClient: () => new TestClient(test.app) };
}

describe("GPX upload when creating (spec 5 feature 2)", () => {
  it("offers a file field in a multipart form", async () => {
    const test = await createTestApp();
    const html = await (await new TestClient(test.app).get("/new")).text();
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('type="file" name="gpx"');
  });

  it("creates the plan with the route, filling distance and the exact start (P8)", async () => {
    const { created, host, planId } = await setup();
    expect(created.status).toBe(200);
    const page = await (await host.get(`/p/${planId}`)).text();
    expect(page).toContain("47.12345, 10.98765");
    expect(page).toContain(`href="/p/${planId}/route.gpx"`);
  });

  it("shows a field error for unusable files and keeps the other values", async () => {
    const test = await createTestApp();
    const client = new TestClient(test.app);
    const response = await createWithGpx(client, "<!DOCTYPE x><gpx/>");
    const html = await response.text();
    expect(response.status).toBe(422);
    expect(html).toContain(escaped(en["field.route_unsafe"]));
    expect(html).toContain('value="Easy Sunday run"');
    expect(client.cookies.has("__Host-rr-device")).toBe(false);
  });

  it("rejects files over 5 MB with a field error, and bodies over the upload limit outright", async () => {
    const test = await createTestApp();
    const client = new TestClient(test.app);
    const justTooBig = await createWithGpx(client, new Uint8Array(5 * 1024 * 1024 + 100));
    expect(justTooBig.status).toBe(422);
    expect(await justTooBig.text()).toContain(escaped(en["field.route_too_large"]));
    const huge = await createWithGpx(client, new Uint8Array(7 * 1024 * 1024));
    expect(huge.status).toBe(413);
  });

  it("keeps the 100 KB limit on routes without uploads", async () => {
    const { host, planId } = await setup();
    const big = await host.postMultipart(
      `/p/${planId}/respond`,
      { note: "x" },
      { gpx: { name: "x.gpx", content: new Uint8Array(200_000) } },
    );
    expect(big.status).toBe(413);
  });
});

describe("GPX download (spec 3.6, decision D10)", () => {
  it("gives participants and the host a clean, regenerated file", async () => {
    const { host, planId, newClient } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");
    for (const client of [host, ben]) {
      const response = await client.get(`/p/${planId}/route.gpx`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/gpx+xml; charset=utf-8");
      expect(response.headers.get("content-disposition")).toBe(
        'attachment; filename="easy-sunday-run.gpx"',
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const file = await response.text();
      expect(file).toContain('<trkpt lat="47.12345" lon="10.98765"><ele>800</ele></trkpt>');
      expect(file).not.toMatch(/<time>|SENTINEL|Old run/);
    }
  });

  it("answers 404 for everyone else, like an unknown plan (P4)", async () => {
    const { planId, newClient } = await setup();
    const cleo = newClient();
    await respondViaUi(cleo, planId, "Cleo", "interested");
    for (const client of [newClient(), cleo]) {
      const response = await client.get(`/p/${planId}/route.gpx`);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain(escaped(en["plan.gone"]));
    }
    expect((await newClient().get("/p/AAAAAAAAAAAAAAAAAAAAAA/route.gpx")).status).toBe(404);
  });
});

describe("routes on the host page (decision D10)", () => {
  it("replaces and removes the route before the start", async () => {
    const { host, planId } = await setup();
    const page = await (await host.get(`/p/${planId}/host`)).text();
    const csrf = hiddenFields(page)._csrf ?? "";
    expect(page).toContain(`action="/p/${planId}/host/route"`);

    const replaced = await host.postMultipart(
      `/p/${planId}/host/route`,
      { _csrf: csrf },
      { gpx: { name: "new.gpx", content: sampleGpx({ lat: 46.5 }) } },
    );
    expect(replaced.status).toBe(303);
    expect(await (await host.get(`/p/${planId}/route.gpx`)).text()).toContain('lat="46.5"');

    const removed = await host.postForm(`/p/${planId}/host/route/remove`, { _csrf: csrf });
    expect(removed.status).toBe(303);
    expect((await host.get(`/p/${planId}/route.gpx`)).status).toBe(404);
  });

  it("does not claim changes were saved when route changes are refused after the start", async () => {
    const { host, planId, clock } = await setup();
    const csrf = (await host.hiddenFields(`/p/${planId}/host`))._csrf ?? "";
    clock.set("2026-06-07T06:00:00Z");
    const upload = await host.postMultipart(
      `/p/${planId}/host/route`,
      { _csrf: csrf },
      { gpx: { name: "r.gpx", content: sampleGpx() } },
    );
    const remove = await host.postForm(`/p/${planId}/host/route/remove`, { _csrf: csrf });
    for (const response of [upload, remove]) {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`/p/${planId}/host`);
    }
  });

  it("shows upload errors on the host page", async () => {
    const { host, planId } = await setup();
    const csrf = (await host.hiddenFields(`/p/${planId}/host`))._csrf ?? "";
    const response = await host.postMultipart(
      `/p/${planId}/host/route`,
      { _csrf: csrf },
      { gpx: { name: "x.gpx", content: "not xml" } },
    );
    expect(response.status).toBe(422);
    expect(await response.text()).toContain(escaped(en["field.route_unreadable"]));
  });
});
