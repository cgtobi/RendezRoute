// The federation foundation through HTTP (spec 7 ActivityPub; decision D36; plan v1.0 step 9a):
// WebFinger and the instance actor, a plan as an `Event` for ActivityPub clients with public fields
// only, the page for everyone else, and nothing of it while FEDERATION_ENABLED is false.
import { generateCryptoKeyPair, signRequest } from "@fedify/fedify";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { FakeOidcServer } from "../../fakes/oidc-server.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";
import { joinOf, remotePerson } from "../../support/remote-people.ts";

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

describe("remote fetches on the personal inboxes (decision I71)", () => {
  /** Posts a signed activity to `path`, signing for the very address it goes to. */
  async function postTo(
    test: Awaited<ReturnType<typeof createTestApp>>,
    path: string,
    from: { id: string; keys: Awaited<ReturnType<typeof generateCryptoKeyPair>> },
    activity: Record<string, unknown>,
    keyId = `${from.id}#main-key`,
  ) {
    const body = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      actor: from.id,
      ...activity,
    });
    const signed = await signRequest(
      new Request(`https://${HOST}${path}`, {
        method: "POST",
        headers: { "content-type": "application/activity+json" },
        body,
      }),
      from.keys.privateKey,
      new URL(keyId),
    );
    return test.app.request(path, { method: "POST", headers: signed.headers, body });
  }

  const follow = (from: { id: string }, object: string) => ({
    id: `${from.id}#follow-1`,
    type: "Follow",
    object,
  });

  it("fetch the key and actor of a signed Follow through OutboundHttp, on the instance actor's inbox", async () => {
    const test = await createTestApp();
    const ben = await remotePerson(test, "ben");
    const response = await postTo(
      test,
      "/actors/instance/inbox",
      ben,
      follow(ben, `https://${HOST}/actors/instance`),
    );
    expect(response.status).toBe(202);
    const fetched = test.federationHttp.requests.map(String);
    expect(fetched).toContain(`${ben.id}#main-key`);
    expect(fetched).toContain(ben.id);
    expect(
      JSON.parse(
        JSON.stringify(test.database.sqlite.prepare("select * from fediverse_followers").all()),
      ),
    ).toHaveLength(1);
  });

  it("do the same on a poster actor's inbox", async () => {
    const oidc = new FakeOidcServer();
    const test = await createTestApp({ env: oidc.env(), oidc });
    const anna = new TestClient(test.app);
    const started = await anna.get("/login/oidc");
    const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), {
      sub: "anna",
      name: "Anna Müller",
    });
    await anna.get(`${callback.pathname}${callback.search}`);
    await anna.postForm("/account/profile", {
      _csrf: (await anna.hiddenFields("/account"))._csrf ?? "",
      handle: "anna",
    });
    const finger = (await (
      await test.app.request(`/.well-known/webfinger?resource=acct:anna@${HOST}`)
    ).json()) as { links: { rel: string; href: string }[] };
    const actor = finger.links.find((link) => link.rel === "self")?.href ?? "";
    const ben = await remotePerson(test, "ben");
    const response = await postTo(
      test,
      new URL(actor).pathname + "/inbox",
      ben,
      follow(ben, actor),
    );
    expect(response.status).toBe(202);
    const fetched = test.federationHttp.requests.map(String);
    expect(fetched).toContain(`${ben.id}#main-key`);
    expect(fetched).toContain(ben.id);
    expect(
      JSON.parse(
        JSON.stringify(test.database.sqlite.prepare("select * from fediverse_followers").all()),
      ),
    ).toHaveLength(1);
  });

  // That the guard itself refuses private addresses is covered by the OutboundHttp adapter tests;
  // here: the key lookup goes through OutboundHttp (the fake records it), and nothing is taken.
  it("send a signature whose key is on a private address through OutboundHttp, and take nothing from it", async () => {
    const test = await createTestApp();
    const ben = await remotePerson(test, "ben");
    for (const keyId of ["http://127.0.0.1/keys/ben#main-key", "https://localhost/keys/ben"]) {
      const response = await postTo(
        test,
        "/actors/instance/inbox",
        ben,
        follow(ben, `https://${HOST}/actors/instance`),
        keyId,
      );
      expect(response.status).toBe(401);
    }
    expect(test.federationHttp.requests.map(String)).toEqual(
      expect.arrayContaining(["http://127.0.0.1/keys/ben#main-key", "https://localhost/keys/ben"]),
    );
    expect(test.federationHttp.posts).toEqual([]);
    expect(
      JSON.stringify(test.database.sqlite.prepare("select * from fediverse_followers").all()),
    ).toBe("[]");
  });

  it("still take a remote Join, its Undo and a reply on the instance actor's inbox", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const ben = await remotePerson(test, "ben");
    const inbox = "/actors/instance/inbox";
    const instance = `https://${HOST}/actors/instance`;
    const found = () => test.planDeps.responses.findRemote(planId, ben.id);
    expect((await postTo(test, inbox, ben, joinOf(ben, planId))).status).toBe(202);
    expect(await found()).toBeDefined();
    // Replies are taken once the plan has started.
    test.clock.set("2026-06-07T06:00:00Z");
    const note = `${ben.id}/statuses/1`;
    const create = await postTo(test, inbox, ben, {
      id: `${note}/activity-1`,
      type: "Create",
      to: [instance],
      object: {
        id: note,
        type: "Note",
        attributedTo: ben.id,
        inReplyTo: `https://${HOST}/p/${planId}`,
        to: [instance],
        content: "<p>Nice one</p>",
        published: "2026-06-07T07:00:00Z",
      },
    });
    expect(create.status).toBe(202);
    const comments = (await test.planDeps.recap.listByPlan(planId)).map((c) => c.body);
    expect(comments.join(" ")).toContain("Nice one");
    expect(
      (
        await postTo(test, inbox, ben, {
          id: `${ben.id}#undo-1`,
          type: "Undo",
          object: { ...joinOf(ben, planId), actor: ben.id },
        })
      ).status,
    ).toBe(202);
    expect(await found()).toBeUndefined();
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

  it("says contributions go as direct messages to joined remote participants, in every language, only while federation is on (decision D44)", async () => {
    const text = (html: string) => html.replaceAll("&#39;", "'");
    const on = await createTestApp();
    for (const language of ["en", "de", "fr"] as const) {
      const page = text(
        await (
          await on.app.request("/privacy", { headers: { "accept-language": language } })
        ).text(),
      );
      expect(page).toContain(translator(language)("privacy.federationRecap"));
    }
    // What it promises: direct messages, copies kept elsewhere, replies counted, withdrawal.
    const notice = en("privacy.federationRecap");
    for (const phrase of [
      "direct message",
      "keep copies",
      "becomes a comment in the recap",
      "withdrawn",
      "account\u2019s data export, which is unchanged",
    ]) {
      expect(notice).toContain(phrase);
    }
    const off = await createTestApp({ env: { FEDERATION_ENABLED: "false" } });
    expect(text(await (await off.app.request("/privacy")).text())).not.toContain(
      en("privacy.federationRecap"),
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
