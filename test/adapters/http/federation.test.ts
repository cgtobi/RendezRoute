// The federation foundation through HTTP (spec 7 ActivityPub; decision D36; plan v1.0 step 9a):
// WebFinger and the instance actor, a plan as an `Event` for ActivityPub clients with public fields
// only, the page for everyone else, and nothing of it while FEDERATION_ENABLED is false.
import { generateCryptoKeyPair, signRequest } from "@fedify/fedify";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const AP = { accept: "application/activity+json" };
const HOST = "runs.example.org";

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

describe("the instance actor (decision D36)", () => {
  it("is found by WebFinger under the instance's host", async () => {
    const { app } = await createTestApp();
    const response = await app.request(`/.well-known/webfinger?resource=acct:${HOST}@${HOST}`);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.subject).toBe(`acct:${HOST}@${HOST}`);
    expect(body.links).toContainEqual(
      expect.objectContaining({ rel: "self", href: `https://${HOST}/actors/instance` }),
    );
    expect((await app.request(`/.well-known/webfinger?resource=acct:anna@${HOST}`)).status).toBe(
      404,
    );
  });

  it("is an Application with the instance's name and both signing keys", async () => {
    const { app } = await createTestApp();
    const actor = await json(await app.request("/actors/instance", { headers: AP }));
    expect(actor).toMatchObject({
      id: `https://${HOST}/actors/instance`,
      type: "Application",
      preferredUsername: HOST,
      name: "RendezRoute",
      inbox: `https://${HOST}/actors/instance/inbox`,
      endpoints: { sharedInbox: `https://${HOST}/inbox` },
    });
    expect(actor.publicKey).toMatchObject({ owner: `https://${HOST}/actors/instance` });
    expect(actor.assertionMethod).toHaveLength(2);
    // No other actor exists yet (poster actors come with step 9b).
    expect((await app.request("/actors/anna", { headers: AP })).status).toBe(404);
  });

  it("takes no unsigned activity", async () => {
    const { app } = await createTestApp();
    const response = await app.request("/inbox", {
      method: "POST",
      headers: { "content-type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        actor: "https://elsewhere.example/users/mallory",
        object: `https://${HOST}/actors/instance`,
      }),
    });
    expect(response.status).toBe(401);
  });
});

describe("a plan as an Event (spec 7 ActivityPub)", () => {
  it("gives ActivityPub clients the public fields only, and browsers the page", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host, { title: "Hill repeats", note: "Bring water." });
    await respondViaUi(new TestClient(app), planId, "Ben", "joined", "");

    const response = await app.request(`/p/${planId}`, { headers: AP });
    expect(response.headers.get("content-type")).toContain("application/activity+json");
    const event = await json(response);
    expect(event).toMatchObject({
      id: `https://${HOST}/p/${planId}`,
      type: "Event",
      name: "Hill repeats",
      content: "<p>Bring water.</p>",
      startTime: "2026-06-07T05:30:00Z",
      url: `https://${HOST}/p/${planId}`,
      attributedTo: `https://${HOST}/actors/instance`,
      // The public area, never the exact start (spec 3.1): the snapped point.
      location: {
        type: "Place",
        name: "Englischer Garten, north end",
        latitude: 48.16,
        longitude: 11.6,
      },
    });
    const text = JSON.stringify(event);
    for (const secret of ["48.16321", "11.60147", "North gate", "Ben"]) {
      expect(text).not.toContain(secret);
    }
    const page = await app.request(`/p/${planId}`, { headers: { accept: "text/html" } });
    expect(page.headers.get("content-type")).toContain("text/html");
  });

  it("says a cancelled plan is cancelled, in the requester's language", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host, { title: "Hill repeats" });
    const page = await (await host.get(`/p/${planId}/host`)).text();
    await host.postForm(`/p/${planId}/host/cancel`, hiddenFields(page));
    const event = await json(
      await app.request(`/p/${planId}`, { headers: { ...AP, "accept-language": "de" } }),
    );
    expect(event.name).toBe(translator("de")("preview.cancelled", { title: "Hill repeats" }));
  });

  it("keeps the page and the Event apart in caches (Vary: Accept)", async () => {
    const { app } = await createTestApp();
    const { planId } = await createPlanViaUi(new TestClient(app));
    // The exact entry: "Accept-Language" alone would not keep them apart.
    const varies = (response: Response) =>
      (response.headers.get("vary") ?? "").split(",").map((entry) => entry.trim());
    expect(varies(await app.request(`/p/${planId}`))).toContain("Accept");
    expect(varies(await app.request(`/p/${planId}`, { headers: AP }))).toContain("Accept");
  });

  it("escapes the note, keeping its line breaks", async () => {
    const { app } = await createTestApp();
    const { planId } = await createPlanViaUi(new TestClient(app), {
      note: "<script>x</script> & more\nSecond line",
    });
    const event = await json(await app.request(`/p/${planId}`, { headers: AP }));
    expect(event.content).toBe("<p>&lt;script&gt;x&lt;/script&gt; &amp; more<br>Second line</p>");
  });

  it("is the page's gone message for a plan that does not exist", async () => {
    const { app } = await createTestApp();
    const response = await app.request("/p/AAAAAAAAAAAAAAAAAAAAAA", { headers: AP });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});

describe("the inboxes (spec 3.11: rate limits)", () => {
  it("take at most a burst of posts from one address, then answer 429", async () => {
    const { app } = await createTestApp();
    const post = () =>
      app.request("/inbox", {
        method: "POST",
        headers: { "content-type": "application/activity+json" },
        body: "{}",
      });
    for (let i = 0; i < 120; i++) expect((await post()).status).not.toBe(429);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    // Only posts to the inboxes count: the pages stay reachable.
    expect((await app.request("/")).status).toBe(200);
  });
});

describe("remote fetches (spec 3.11: through OutboundHttp)", () => {
  it("fetch a signed post's key through OutboundHttp, with its SSRF rules", async () => {
    const { app, federationHttp } = await createTestApp();
    const keys = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
    const actor = "https://social.example/users/ben";
    federationHttp.respond(actor, {
      headers: { "content-type": "application/activity+json" },
      body: JSON.stringify({
        "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
        id: actor,
        type: "Person",
        inbox: `${actor}/inbox`,
        publicKey: {
          id: `${actor}#main-key`,
          owner: actor,
          publicKeyPem: await publicKeyPem(keys.publicKey),
        },
      }),
    });
    const body = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${actor}#follow-1`,
      type: "Follow",
      actor,
      object: `https://${HOST}/actors/instance`,
    });
    const signed = await signRequest(
      new Request(`https://${HOST}/inbox`, {
        method: "POST",
        headers: { "content-type": "application/activity+json" },
        body,
      }),
      keys.privateKey,
      new URL(`${actor}#main-key`),
    );
    await app.request("/inbox", {
      method: "POST",
      headers: signed.headers,
      body,
    });
    expect(federationHttp.requests.map(String)).toContain(`${actor}#main-key`);
  });
});

describe("FEDERATION_ENABLED=false", () => {
  it("has no actor, no WebFinger, and only the page for a plan", async () => {
    const { app } = await createTestApp({ env: { FEDERATION_ENABLED: "false" } });
    expect((await app.request(`/.well-known/webfinger?resource=acct:${HOST}@${HOST}`)).status).toBe(
      404,
    );
    expect((await app.request("/actors/instance", { headers: AP })).status).toBe(404);
    const { planId } = await createPlanViaUi(new TestClient(app));
    const page = await app.request(`/p/${planId}`, { headers: AP });
    expect(page.headers.get("content-type")).toContain("text/html");
  });
});

describe("privacy notice", () => {
  it("says the exact start and route go to accepted remote participants, only while federation is on (decision D43)", async () => {
    const text = (html: string) => html.replaceAll("&#39;", "'");
    const on = await createTestApp();
    expect(text(await (await on.app.request("/privacy")).text())).toContain(
      en("privacy.federationNotes"),
    );
    const off = await createTestApp({ env: { FEDERATION_ENABLED: "false" } });
    expect(text(await (await off.app.request("/privacy")).text())).not.toContain(
      en("privacy.federationNotes"),
    );
  });

  it("says the instance takes part in the fediverse, only while it does", async () => {
    const text = (html: string) => html.replaceAll("&#39;", "'");
    const on = await createTestApp();
    expect(text(await (await on.app.request("/privacy")).text())).toContain(
      en("privacy.federation", { host: HOST, days: 30 }),
    );
    const off = await createTestApp({ env: { FEDERATION_ENABLED: "false" } });
    expect(text(await (await off.app.request("/privacy")).text())).not.toContain(
      en("privacy.federation", { host: HOST, days: 30 }),
    );
  });
});

// The form posts of the plan's own pages still pass the CSRF check behind Fedify's middleware.
describe("the app behind the federation middleware", () => {
  it("keeps its own forms working", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host);
    const page = await (await host.get(`/p/${planId}/host`)).text();
    expect((await host.postForm(`/p/${planId}/host/cancel`, hiddenFields(page))).status).toBe(303);
  });
});

/** A public key as PEM, as Mastodon publishes it. */
async function publicKeyPem(key: CryptoKey): Promise<string> {
  const der = Buffer.from(await crypto.subtle.exportKey("spki", key));
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}
