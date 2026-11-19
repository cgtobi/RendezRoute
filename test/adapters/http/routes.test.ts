import { describe, expect, it } from "vite-plus/test";
import { en } from "../../../src/adapters/i18n/messages/en.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { sampleGpx } from "../../support/gpx.ts";
import { escaped } from "../../support/html.ts";
import { editForm, planForm, respondViaUi, uploadViaEdit } from "../../support/plans.ts";

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
  it("saves a route with the edit form, which is multipart and has no separate upload", async () => {
    const { host, planId } = await setup();
    const page = await (await host.get(`/p/${planId}/host`)).text();
    expect(page).toMatch(
      new RegExp(
        `<form method="post" action="/p/${planId}/host" class="plan-form" enctype="multipart/form-data"`,
      ),
    );
    expect(page).not.toContain(`action="/p/${planId}/host/route"`);
    expect(page).not.toContain(escaped("Replace route"));
    expect(page).not.toContain(escaped("Upload route"));

    const replaced = await uploadViaEdit(host, planId, sampleGpx({ lat: 46.5 }), { gpxTrim: "0" });
    expect(replaced.status).toBe(303);
    expect(replaced.headers.get("location")).toBe(`/p/${planId}/host?saved`);
    expect(await (await host.get(`/p/${planId}/route.gpx`)).text()).toContain('lat="46.5"');
  });

  it("keeps a title edit made in the same save as the upload", async () => {
    const { host, planId } = await setup();
    const response = await uploadViaEdit(host, planId, sampleGpx({ lat: 46.5 }), {
      title: "Renamed run",
      gpxTrim: "0",
    });
    expect(response.status).toBe(303);
    expect(await (await host.get(`/p/${planId}/host`)).text()).toContain('value="Renamed run"');
    expect(await (await host.get(`/p/${planId}/route.gpx`)).text()).toContain('lat="46.5"');
  });

  it("saves nothing when the file is unusable, and asks for it again", async () => {
    const { host, planId } = await setup();
    const before = await (await host.get(`/p/${planId}/route.gpx`)).text();
    const response = await uploadViaEdit(host, planId, "not xml", {
      title: "Renamed run",
      gpxTrim: "200",
    });
    expect(response.status).toBe(422);
    const html = await response.text();
    expect(html).toContain('value="Renamed run"');
    expect(html).toContain('id="field-gpx-error"');
    expect(html).toContain(escaped(en["field.route_unreadable"]));
    expect(html).toContain(escaped(en["form.gpxChooseAgain"]));
    expect(html).toMatch(
      /id="field-gpx"[^>]*aria-describedby="field-gpx-hint field-gpx-again field-gpx-error"/,
    );
    expect(html).toContain('<option value="200" selected="">');
    // The problem bar names the route and leads to the file field (decision 006).
    expect(html).toContain("data-problem");
    expect(html).toContain('href="#field-gpx"');
    expect(html).toContain(escaped(en["form.gpx"]));

    expect(await (await host.get(`/p/${planId}/host`)).text()).toContain('value="Easy Sunday run"');
    expect(await (await host.get(`/p/${planId}/route.gpx`)).text()).toBe(before);
  });

  it("does not claim changes were saved when route changes are refused after the start", async () => {
    const { host, planId, clock } = await setup();
    const fields = await editForm(host, planId);
    clock.set("2026-06-07T06:00:00Z");
    const upload = await host.postMultipart(
      `/p/${planId}/host`,
      { ...fields, gpx: "" },
      { gpx: { name: "r.gpx", content: sampleGpx() } },
    );
    const remove = await host.postForm(`/p/${planId}/host/route/remove`, {
      _csrf: fields._csrf ?? "",
    });
    for (const response of [upload, remove]) {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`/p/${planId}/host`);
    }
  });

  it("no longer has a separate upload address", async () => {
    const { host, planId } = await setup();
    const csrf = (await host.hiddenFields(`/p/${planId}/host`))._csrf ?? "";
    const response = await host.postMultipart(
      `/p/${planId}/host/route`,
      { _csrf: csrf },
      { gpx: { name: "r.gpx", content: sampleGpx() } },
    );
    expect(response.status).toBe(404);
  });

  it("takes files up to 5 MB with the edit, refuses bigger ones, and keeps 100 KB for removing", async () => {
    const { host, planId } = await setup();
    const before = await (await host.get(`/p/${planId}/route.gpx`)).text();
    const justTooBig = await uploadViaEdit(host, planId, new Uint8Array(5 * 1024 * 1024 + 100), {
      title: "Renamed run",
    });
    expect(justTooBig.status).toBe(422);
    expect(await justTooBig.text()).toContain(escaped(en["field.route_too_large"]));
    const huge = await uploadViaEdit(host, planId, new Uint8Array(7 * 1024 * 1024));
    expect(huge.status).toBe(413);
    const csrf = (await host.hiddenFields(`/p/${planId}/host`))._csrf ?? "";
    const bigRemove = await host.postMultipart(
      `/p/${planId}/host/route/remove`,
      { _csrf: csrf },
      { gpx: { name: "x.gpx", content: new Uint8Array(200_000) } },
    );
    expect(bigRemove.status).toBe(413);
    expect(await (await host.get(`/p/${planId}/host`)).text()).toContain('value="Easy Sunday run"');
    expect(await (await host.get(`/p/${planId}/route.gpx`)).text()).toBe(before);
  });
});

describe("removing the route on the host page (decision D10)", () => {
  it("is a confirmation inside the route fold whose button submits a separate form", async () => {
    const { host, planId } = await setup();
    const page = await (await host.get(`/p/${planId}/host`)).text();
    const planForm =
      /<form[^>]*action="\/p\/[^"]+\/host"[^>]*>[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(planForm).toContain('<details class="danger-zone remove-route">');
    expect(planForm).toContain(escaped(en["host.routeRemoveOpen"]));
    expect(planForm).toContain('form="route-remove"');
    expect(planForm).toContain(escaped(en["fold.routeSet"]));
    expect(planForm).toContain(escaped(en["form.gpxHintReplace"]));
    // Outside the edit form: forms cannot nest.
    expect(planForm).not.toContain('id="route-remove"');
    const removeForm = /<form id="route-remove"[^>]*>[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(removeForm).toContain(`action="/p/${planId}/host/route/remove"`);
    expect(removeForm).toContain(" hidden");

    const removed = await host.postForm(`/p/${planId}/host/route/remove`, hiddenFields(removeForm));
    expect(removed.status).toBe(303);
    expect(removed.headers.get("location")).toBe(`/p/${planId}/host?saved`);
    expect((await host.get(`/p/${planId}/route.gpx`)).status).toBe(404);

    const after = await (await host.get(`/p/${planId}/host`)).text();
    expect(after).not.toContain('id="route-remove"');
    expect(after).not.toContain('form="route-remove"');
    expect(after).not.toContain("remove-route");
    expect(after).toContain(escaped(en["fold.routeNone"]));
    expect(after).toContain(escaped(en["form.gpxHintAdd"]));
  });

  it("shows the hiding choice and its hint without scripts", async () => {
    const { host, planId } = await setup();
    const page = await (await host.get(`/p/${planId}/host`)).text();
    expect(page).toMatch(/<div class="field" data-gpx-trim="">/);
    expect(page).not.toMatch(/data-gpx-trim=""[^>]*hidden/);
    expect(page).toContain(escaped(en["form.gpxTrimOnlyWithFile"]));
    expect(page).toContain(`data-too-large="${escaped(en["field.route_too_large"])}"`);
  });
});

describe("hiding the start and end of a route (decision D13)", () => {
  const TRIM_OPTIONS = ["0", "200", "500", "1000"].map((m) => `<option value="${m}"`);

  it("offers the choice next to both upload fields, 500 m by default (decision D40)", async () => {
    const { host, planId } = await setup();
    for (const path of ["/new", `/p/${planId}/host`]) {
      const html = await (await host.get(path)).text();
      expect(html).toContain('name="gpxTrim"');
      for (const option of TRIM_OPTIONS) expect(html).toContain(option);
      expect(html).toContain('<option value="500" selected="">');
    }
  });

  it("removes the trimmed points from the stored route, the download and the exact start", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const hidden = await host.hiddenFields("/new");
    const created = await host.postMultipart(
      "/new",
      { ...hidden, ...planForm(noExactPoint), gpxTrim: "200" },
      { gpx: { name: "run.gpx", content: sampleGpx({ count: 10 }) } },
    );
    const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(await created.text())?.[1] ?? "";
    const gpx = await (await host.get(`/p/${planId}/route.gpx`)).text();
    expect(gpx).not.toContain('lat="47.12345"');
    expect(gpx).not.toContain('lat="47.12445"');
    expect(gpx).toMatch(/<trkseg>\s*<trkpt lat="47.12545"/);
    expect(gpx).not.toContain('lat="47.13245"');
    expect(await (await host.get(`/p/${planId}`)).text()).toContain("47.12545, 10.98765");
  });

  it("explains a route trimmed away and keeps the chosen distance", async () => {
    const test = await createTestApp();
    const client = new TestClient(test.app);
    const hidden = await client.hiddenFields("/new");
    const response = await client.postMultipart(
      "/new",
      { ...hidden, ...planForm(noExactPoint), gpxTrim: "1000" },
      { gpx: { name: "run.gpx", content: sampleGpx() } },
    );
    const html = await response.text();
    expect(response.status).toBe(422);
    expect(html).toContain(escaped(en["field.route_trimmed_away"]));
    expect(html).toContain('<option value="1000" selected="">');
  });

  it("trims routes uploaded on the host page", async () => {
    const { host, planId } = await setup();
    const response = await uploadViaEdit(host, planId, sampleGpx({ lat: 46.5, count: 10 }), {
      gpxTrim: "200",
    });
    expect(response.status).toBe(303);
    const gpx = await (await host.get(`/p/${planId}/route.gpx`)).text();
    expect(gpx).toMatch(/<trkseg>\s*<trkpt lat="46.502"/);
  });
});

describe("a form posted without the hiding choice (decisions D13, D40)", () => {
  it("means no hiding: the route is kept whole, however the browser's 500 m default looks", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const created = await createWithGpx(host, sampleGpx({ count: 10 }));
    const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(await created.text())?.[1] ?? "";
    const gpx = await (await host.get(`/p/${planId}/route.gpx`)).text();
    expect(gpx).toMatch(/<trkseg>\s*<trkpt lat="47.12345"/);
    expect(gpx).toContain('lat="47.13245"');

    await uploadViaEdit(host, planId, sampleGpx({ lat: 46.5, count: 10 }), {
      gpxTrim: undefined,
    });
    const replaced = await (await host.get(`/p/${planId}/route.gpx`)).text();
    expect(replaced).toMatch(/<trkseg>\s*<trkpt lat="46.5"/);
  });
});

describe("cutting a route to the meeting point (decision D40)", () => {
  // The recording starts at home (47.12345) and passes the meeting point 7 points (≈780 m) on.
  const meeting = { exactLat: "47.13060", exactLng: "10.98765", distanceKm: "" };
  const firstPoint = (gpx: string) => /<trkpt lat="([\d.]+)"/.exec(gpx)?.[1];

  it("stores the route from the meeting point on, never the way there", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const hidden = await host.hiddenFields("/new");
    const created = await host.postMultipart(
      "/new",
      { ...hidden, ...planForm(meeting), gpxTrim: "500" },
      { gpx: { name: "run.gpx", content: sampleGpx({ count: 20 }) } },
    );
    const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(await created.text())?.[1] ?? "";
    const gpx = await (await host.get(`/p/${planId}/route.gpx`)).text();
    expect(firstPoint(gpx)).toBe("47.13045");
    for (const before of ["47.12345", "47.12645", "47.12945"]) expect(gpx).not.toContain(before);
    // The far end is hidden as chosen: the last 500 m are gone.
    expect(gpx).not.toContain('lat="47.14245"');
    expect(gpx).not.toContain('lat="47.13845"');
  });

  it("cuts routes uploaded on the host page the same way", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const created = await createWithGpx(host, sampleGpx({ lat: 46.5 }), meeting);
    const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(await created.text())?.[1] ?? "";
    await uploadViaEdit(host, planId, sampleGpx({ count: 20 }), { gpxTrim: "0" });
    const gpx = await (await host.get(`/p/${planId}/route.gpx`)).text();
    expect(firstPoint(gpx)).toBe("47.13045");
    // Hiding off: the far end stays.
    expect(gpx).toContain('lat="47.14245"');
  });
});
