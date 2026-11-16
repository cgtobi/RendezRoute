import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { sampleGpx } from "../../support/gpx.ts";
import { escaped } from "../../support/html.ts";
import { hiddenFields } from "../../support/client.ts";
import { createPlanViaUi, planForm, respondViaUi } from "../../support/plans.ts";

/** A browser behind the trusted proxy, seen with the given address. */
class ClientAt extends TestClient {
  constructor(
    app: ConstructorParameters<typeof TestClient>[0],
    private readonly ip: string,
  ) {
    super(app);
  }

  override request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("x-forwarded-for", this.ip);
    return super.request(path, { ...init, headers });
  }
}

async function setup() {
  const test = await createTestApp({ env: { TRUST_PROXY: "true" } });
  return { ...test, at: (ip: string) => new ClientAt(test.app, ip) };
}

const en = translator("en");

describe("rate limits on creating plans (spec 5 feature 12, decision I32)", () => {
  it("allow a burst of 5 plans per client, then answer 429 with Retry-After", async () => {
    const { at } = await setup();
    const client = at("203.0.113.5");
    for (let i = 0; i < 5; i++) await createPlanViaUi(client);

    const hidden = await client.hiddenFields("/new");
    const refused = await client.postForm("/new", { ...hidden, ...planForm() });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("360");
    // The message as the heading of an error page (decision D29).
    expect(await refused.text()).toContain(
      `<main><section class="message-page"><h1>${escaped(en("error.rateLimited"))}</h1></section></main>`,
    );

    await createPlanViaUi(at("203.0.113.6"));
  });

  it("refill over time", async () => {
    const { at, clock } = await setup();
    const client = at("203.0.113.5");
    for (let i = 0; i < 5; i++) await createPlanViaUi(client);
    clock.advance({ minutes: 6 });
    expect((await createPlanViaUi(client)).response.status).toBe(200);
  });

  it("count only plans actually created, so fixing form errors is never blocked", async () => {
    const { at } = await setup();
    const client = at("203.0.113.5");
    for (let i = 0; i < 8; i++) {
      const hidden = await client.hiddenFields("/new");
      const invalid = await client.postForm("/new", { ...hidden, ...planForm({ title: "" }) });
      expect(invalid.status).toBe(422);
    }
    await createPlanViaUi(client);
  });

  it("hold for parallel requests, which reserve their token before any work", async () => {
    const { at } = await setup();
    const clients = Array.from({ length: 8 }, () => at("203.0.113.5"));
    const forms = await Promise.all(clients.map((client) => client.hiddenFields("/new")));
    const responses = await Promise.all(
      clients.map((client, i) => client.postForm("/new", { ...forms[i], ...planForm() })),
    );
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
  });

  it("treat one IPv6 /64 network as one client", async () => {
    const { at } = await setup();
    for (let i = 0; i < 5; i++) await createPlanViaUi(at(`2001:db8:1:2::${i + 1}`));
    const client = at("2001:db8:1:2::99");
    const hidden = await client.hiddenFields("/new");
    expect((await client.postForm("/new", { ...hidden, ...planForm() })).status).toBe(429);
  });

  it("ignore forwarded addresses without TRUST_PROXY, counting the proxy as one client", async () => {
    const test = await createTestApp();
    for (let i = 0; i < 5; i++) await createPlanViaUi(new ClientAt(test.app, `203.0.113.${i}`));
    const client = new ClientAt(test.app, "198.51.100.1");
    const hidden = await client.hiddenFields("/new");
    expect((await client.postForm("/new", { ...hidden, ...planForm() })).status).toBe(429);
  });
});

describe("rate limits on responses (spec 5 feature 12)", () => {
  it("hold for parallel responses", async () => {
    const { at } = await setup();
    const { planId } = await createPlanViaUi(at("198.51.100.1"));
    const clients = Array.from({ length: 13 }, () => at("203.0.113.5"));
    const forms = await Promise.all(clients.map((client) => client.hiddenFields(`/p/${planId}`)));
    const responses = await Promise.all(
      clients.map((client, i) =>
        client.postForm(`/p/${planId}/respond`, {
          ...forms[i],
          displayName: `Runner ${i}`,
          choice: "joined",
        }),
      ),
    );
    const created = responses.filter((response) => response.status === 200).length;
    expect([created, responses.length - created]).toEqual([10, 3]);
  });

  it("allow 10 responses per client in a burst", async () => {
    const { at } = await setup();
    const { planId } = await createPlanViaUi(at("198.51.100.1"));
    for (let i = 0; i < 10; i++)
      await respondViaUi(at("203.0.113.5"), planId, `Runner ${i}`, "joined");

    const client = at("203.0.113.5");
    const hidden = await client.hiddenFields(`/p/${planId}`);
    const refused = await client.postForm(`/p/${planId}/respond`, {
      ...hidden,
      displayName: "One too many",
      choice: "joined",
    });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("120");
  });
});

describe("rate limits on route files (decision I32, review fix)", () => {
  const upload = async (client: ClientAt, planId: string) => {
    const html = await (await client.get(`/p/${planId}/host`)).text();
    return client.postMultipart(`/p/${planId}/host/route`, hiddenFields(html), {
      gpx: { name: "run.gpx", content: sampleGpx() },
    });
  };

  it("count every request carrying a route file, also on the host page", async () => {
    const { at } = await setup();
    const host = at("203.0.113.5");
    const { planId } = await createPlanViaUi(host);
    for (let i = 0; i < 10; i++) expect((await upload(host, planId)).status).toBe(303);
    const refused = await upload(host, planId);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("120");
  });

  it("count route files sent with an invalid form, which never create a plan", async () => {
    const { at } = await setup();
    const client = at("203.0.113.5");
    const send = async () => {
      const hidden = await client.hiddenFields("/new");
      return client.postMultipart(
        "/new",
        { ...hidden, ...planForm({ title: "" }) },
        { gpx: { name: "run.gpx", content: sampleGpx() } },
      );
    };
    for (let i = 0; i < 10; i++) expect((await send()).status).toBe(422);
    expect((await send()).status).toBe(429);
  });
});

describe("rate limits on place search (decision I32)", () => {
  it("allow 10 searches per client in a burst", async () => {
    const { at, geocoder } = await setup();
    const client = at("203.0.113.5");
    const csrf = (await client.hiddenFields("/new"))._csrf ?? "";
    const search = () =>
      client.request("/geocode", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ q: "Flaucher" }),
      });
    for (let i = 0; i < 10; i++) expect((await search()).status).toBe(200);
    const refused = await search();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "rate_limited" });
    expect(refused.headers.get("retry-after")).toBe("6");
    expect(geocoder.calls).toHaveLength(10);
  });
});

describe("rate limits on the label suggestion (decision D70)", () => {
  it("allows 10 lookups per client in a burst", async () => {
    const { at, geocoder } = await setup();
    const client = at("203.0.113.6");
    const csrf = (await client.hiddenFields("/new"))._csrf ?? "";
    const lookup = () =>
      client.request("/geocode/reverse", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ lat: 48.11, lng: 11.56 }),
      });
    for (let i = 0; i < 10; i++) expect((await lookup()).status).toBe(200);
    const refused = await lookup();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "rate_limited" });
    expect(refused.headers.get("retry-after")).toBe("6");
    expect(geocoder.reverseCalls).toHaveLength(10);
  });
});

describe("the place search and the label suggestion share one budget (decision D70)", () => {
  async function mixed(first: "search" | "reverse") {
    const { at, geocoder } = await setup();
    const client = at("203.0.113.7");
    const csrf = (await client.hiddenFields("/new"))._csrf ?? "";
    const post = (path: string, body: unknown) =>
      client.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(body),
      });
    const search = () => post("/geocode", { q: "Flaucher" });
    const reverse = () => post("/geocode/reverse", { lat: 48.11, lng: 11.56 });
    const [burst, other] = first === "search" ? [search, reverse] : [reverse, search];
    for (let i = 0; i < 10; i++) expect((await burst()).status).toBe(200);
    expect((await other()).status).toBe(429);
    return geocoder.calls.length + geocoder.reverseCalls.length;
  }

  it("refuses a lookup after 10 searches", async () => {
    expect(await mixed("search")).toBe(10);
  });
  it("refuses a search after 10 lookups", async () => {
    expect(await mixed("reverse")).toBe(10);
  });
});

describe("rate limits on preview rendering (spec 6 abuse, decision I32)", () => {
  it("count only renders, so cached cards stay available to chat apps", async () => {
    const { at, previewRenderer } = await setup();
    const planIds: string[] = [];
    for (let i = 0; i < 11; i++) {
      planIds.push((await createPlanViaUi(at(`198.51.100.${i}`))).planId);
    }
    const fetcher = at("203.0.113.5");
    for (const planId of planIds.slice(0, 10)) {
      expect((await fetcher.get(`/p/${planId}/og.png`)).status).toBe(200);
    }
    for (let i = 0; i < 5; i++) {
      expect((await fetcher.get(`/p/${planIds[0]}/og.png`)).status).toBe(200);
    }
    const refused = await fetcher.get(`/p/${planIds[10]}/og.png`);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(previewRenderer.rendered).toHaveLength(10);
  });
});
