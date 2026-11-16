// Following through the inboxes (spec 7 ActivityPub; decision D38; 0.9 step 10a): a signed
// `Follow` of the instance actor or a poster's actor is stored and answered with a signed `Accept`
// through the job queue; `Undo` and an actor's `Delete` of itself forget the follower; the
// followers collection shows a count only; retiring a profile tells its followers.
import { signRequest, verifyRequest } from "@fedify/fedify";
import type { generateCryptoKeyPair } from "@fedify/fedify";
import { describe, expect, it } from "vite-plus/test";
import { outboundContextLoader } from "../../../src/adapters/out/federation/document-loader.ts";
import { FakeOidcServer } from "../../fakes/oidc-server.ts";
import { FakeOutboundHttp } from "../../fakes/outbound-http.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { otherSharedRsaKeyPair, sharedRsaKeyPair } from "../../support/remote-people.ts";
import { createPlanViaUi, editForm } from "../../support/plans.ts";
import { translator } from "../../../src/adapters/i18n/i18n.ts";

const AP = { accept: "application/activity+json" };
const HOST = "runs.example.org";
const INSTANCE = `https://${HOST}/actors/instance`;

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Keys = Awaited<ReturnType<typeof generateCryptoKeyPair>>;

/** A remote person whose actor document the fake serves, with its own keys. */
async function remotePerson(
  test: TestApp,
  name: string,
  server = "social.example",
  { inboxServer = server }: { inboxServer?: string } = {},
) {
  const keys = await sharedRsaKeyPair();
  const id = `https://${server}/users/${name}`;
  const der = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${(der.toString("base64").match(/.{1,64}/g) ?? []).join("\n")}\n-----END PUBLIC KEY-----\n`;
  test.federationHttp.respond(id, {
    headers: { "content-type": "application/activity+json" },
    body: JSON.stringify({
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
      id,
      type: "Person",
      inbox: `https://${inboxServer}/users/${name}/inbox`,
      endpoints: { sharedInbox: `https://${inboxServer}/inbox` },
      publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: pem },
    }),
  });
  test.federationHttp.respond(`https://${server}/inbox`, { status: 202 });
  return { id, keys };
}

async function post(
  test: TestApp,
  from: { id: string; keys: Keys },
  activity: Record<string, unknown>,
  path = "/inbox",
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
    new URL(`${from.id}#main-key`),
  );
  return test.app.request(path, { method: "POST", headers: signed.headers, body });
}

const followOf = (from: { id: string }, object: string, n = 1) => ({
  id: `${from.id}#follow-${n}`,
  type: "Follow",
  object,
});

/** What the app delivered, with the activity parsed. */
const delivered = (test: TestApp) =>
  test.federationHttp.posts.map((sent) => ({
    url: sent.url.href,
    headers: sent.headers,
    body: sent.body,
    activity: JSON.parse(new TextDecoder().decode(sent.body)) as Record<string, unknown>,
  }));

const count = async (test: TestApp, actorPath: string) => {
  const collection = (await (
    await test.app.request(`${actorPath}/followers`, { headers: AP })
  ).json()) as Record<string, unknown>;
  return collection;
};

describe("following the instance actor (decision D38)", () => {
  it("is accepted with a signed Accept, delivered through the job queue", async () => {
    const test = await createTestApp();
    const ben = await remotePerson(test, "ben");
    const response = await post(test, ben, followOf(ben, INSTANCE));
    expect(response.status).toBe(202);
    // Nothing is sent from the request itself: the job runner delivers.
    expect(test.federationHttp.posts).toEqual([]);
    await test.runJobs();

    const [accept, ...more] = delivered(test);
    expect(more).toEqual([]);
    if (accept === undefined) throw new Error("nothing delivered");
    expect(accept.url).toBe("https://social.example/inbox");
    expect(accept.activity).toMatchObject({
      type: "Accept",
      actor: INSTANCE,
      to: ben.id,
      object: { id: `${ben.id}#follow-1`, type: "Follow", actor: ben.id, object: INSTANCE },
    });
    // Signed with the instance actor's key, as its actor document publishes it.
    const app = test.app;
    const documentLoader = async (url: string) => ({
      contextUrl: null,
      documentUrl: url,
      document: (await (
        await app.request(new URL(url).pathname, { headers: AP })
      ).json()) as unknown,
    });
    const key = await verifyRequest(
      new Request(accept.url, { method: "POST", headers: accept.headers, body: accept.body }),
      { documentLoader, contextLoader: outboundContextLoader(new FakeOutboundHttp()) },
    );
    expect(key?.id?.href).toBe(`${INSTANCE}#main-key`);
  });

  it("shows how many follow, never who", async () => {
    const test = await createTestApp();
    const ben = await remotePerson(test, "ben");
    const cleo = await remotePerson(test, "cleo", "other.example");
    await post(test, ben, followOf(ben, INSTANCE));
    await post(test, cleo, followOf(cleo, INSTANCE));
    const actor = (await (
      await test.app.request("/actors/instance", { headers: AP })
    ).json()) as Record<string, unknown>;
    expect(actor.followers).toBe(`${INSTANCE}/followers`);
    const collection = await count(test, "/actors/instance");
    expect(collection.totalItems).toBe(2);
    expect(JSON.stringify(collection)).not.toContain("social.example");
  });

  it("forgets a follower on Undo, or when it deletes itself, but not on someone else's Undo", async () => {
    const test = await createTestApp();
    const ben = await remotePerson(test, "ben");
    // On the same server, so Fedify trusts the embedded Follow and only our check stops it.
    const mallory = await remotePerson(test, "mallory");
    await post(test, ben, followOf(ben, INSTANCE));
    const undo = (by: { id: string }) => ({
      id: `${by.id}#undo-1`,
      type: "Undo",
      object: { ...followOf(ben, INSTANCE), actor: ben.id },
    });
    await post(test, mallory, undo(mallory));
    expect((await count(test, "/actors/instance")).totalItems).toBe(1);
    await post(test, ben, undo(ben));
    expect((await count(test, "/actors/instance")).totalItems).toBe(0);

    await post(test, ben, followOf(ben, INSTANCE, 2));
    await post(test, mallory, followOf(mallory, INSTANCE));
    // Deleting someone else, or something else, changes nothing; deleting oneself is forgotten.
    await post(test, mallory, { id: `${mallory.id}#delete`, type: "Delete", object: ben.id });
    await post(test, mallory, {
      id: `${mallory.id}#delete-note`,
      type: "Delete",
      object: `${mallory.id}/statuses/1`,
    });
    expect((await count(test, "/actors/instance")).totalItems).toBe(2);
    await post(test, ben, { id: `${ben.id}#delete`, type: "Delete", object: ben.id });
    expect((await count(test, "/actors/instance")).totalItems).toBe(1);
  });

  it("keeps neither the follower's address nor the instance key readable in the database", async () => {
    const test = await createTestApp();
    const ben = await remotePerson(test, "ben");
    await post(test, ben, followOf(ben, INSTANCE));
    const tables = ["fediverse_followers", "job_queue"].map((table) =>
      JSON.stringify(test.database.sqlite.prepare(`select * from ${table}`).all()),
    );
    expect(tables[0]).toContain("enc");
    for (const rows of tables) expect(rows).not.toContain("social.example");
    // The queued Accept names its signer; the instance key stays in the key directory (spec 2b).
    const [job] = await test.jobs.due(test.clock.now(), 10);
    expect(job?.payload).toMatchObject({ localActor: "instance" });
    expect(job?.payload).not.toHaveProperty("privateKey");
  });

  it("refuses a follower whose inboxes are on another server", async () => {
    const test = await createTestApp();
    const ben = await remotePerson(test, "ben", "social.example", {
      inboxServer: "victim.example",
    });
    await post(test, ben, followOf(ben, INSTANCE));
    await test.runJobs();
    expect(test.federationHttp.posts).toEqual([]);
    expect((await count(test, "/actors/instance")).totalItems).toBe(0);
  });

  it("forgets a follower whose account is gone, though it can no longer sign", async () => {
    const test = await createTestApp();
    const ben = await remotePerson(test, "ben");
    await post(test, ben, followOf(ben, INSTANCE));
    // A Delete that does not verify (here: signed with another key) while the account exists
    // changes nothing.
    const other = { id: ben.id, keys: await otherSharedRsaKeyPair() };
    const deleteSelf = { id: `${ben.id}#delete`, type: "Delete", object: ben.id };
    expect((await post(test, other, deleteSelf)).status).toBe(401);
    expect((await count(test, "/actors/instance")).totalItems).toBe(1);
    // Once its server says it is gone, the Delete is believed.
    test.federationHttp.respond(ben.id, { status: 410 });
    expect((await post(test, other, deleteSelf)).status).toBe(202);
    expect((await count(test, "/actors/instance")).totalItems).toBe(0);
  });

  it("ignores a Follow of an actor that does not exist", async () => {
    const test = await createTestApp();
    const ben = await remotePerson(test, "ben");
    await post(test, ben, followOf(ben, `https://${HOST}/actors/nobody`));
    await test.runJobs();
    expect(test.federationHttp.posts).toEqual([]);
  });
});

describe("following a poster's actor (decisions D37, D38)", () => {
  it("is accepted while the profile is on; turning it off tells the followers once per server", async () => {
    const oidc = new FakeOidcServer();
    const test = await createTestApp({ env: oidc.env(), oidc });
    const anna = new TestClient(test.app);
    const started = await anna.get("/login/oidc");
    const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), {
      sub: "anna",
      name: "Anna Müller",
    });
    await anna.get(`${callback.pathname}${callback.search}`);
    const csrf = async () => (await anna.hiddenFields("/account"))._csrf ?? "";
    await anna.postForm("/account/profile", { _csrf: await csrf(), handle: "anna" });
    const finger = (await (
      await test.app.request(`/.well-known/webfinger?resource=acct:anna@${HOST}`)
    ).json()) as { links: { rel: string; href: string }[] };
    const actor = finger.links.find((link) => link.rel === "self")?.href ?? "";

    const ben = await remotePerson(test, "ben");
    const cleo = await remotePerson(test, "cleo");
    await post(test, ben, followOf(ben, actor));
    await post(test, cleo, followOf(cleo, actor));
    await test.runJobs();
    expect(delivered(test).map((sent) => sent.activity.type)).toEqual(["Accept", "Accept"]);
    expect(await (await anna.get("/account")).text()).toContain("2 people in the fediverse");

    await anna.postForm("/account/profile/off", { _csrf: await csrf() });
    await test.runJobs();
    // One delivery for the server both follow from, to its shared inbox.
    const [gone, ...more] = delivered(test).slice(2);
    expect(more).toEqual([]);
    expect(gone?.url).toBe("https://social.example/inbox");
    expect(gone?.activity).toMatchObject({ type: "Delete", actor, object: actor, to: "as:Public" });
    expect(gone?.headers.signature).toContain(`keyId="${actor}#main-key"`);
    // A retired actor takes no follows.
    await post(test, ben, followOf(ben, actor, 2));
    await test.runJobs();
    expect(delivered(test)).toHaveLength(3);
    // Gone with the actor: no followers collection either (it answers 410 itself).
    const collection = await test.app.request(`${new URL(actor).pathname}/followers`, {
      headers: AP,
    });
    expect(collection.status).toBe(404);
  });
});

describe("publishing plans (decisions D38, D39)", () => {
  it("sends a shared plan to the followers as an Event with public fields, and a Delete when it goes", async () => {
    const oidc = new FakeOidcServer();
    const test = await createTestApp({ env: oidc.env(), oidc });
    const anna = new TestClient(test.app);
    const started = await anna.get("/login/oidc");
    const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), {
      sub: "anna",
      name: "Anna Müller",
    });
    await anna.get(`${callback.pathname}${callback.search}`);
    const csrf = (await anna.hiddenFields("/account"))._csrf ?? "";
    await anna.postForm("/account/profile", { _csrf: csrf, handle: "anna" });
    const finger = (await (
      await test.app.request(`/.well-known/webfinger?resource=acct:anna@${HOST}`)
    ).json()) as { links: { rel: string; href: string }[] };
    const actor = finger.links.find((link) => link.rel === "self")?.href ?? "";
    const ben = await remotePerson(test, "ben");
    await post(test, ben, followOf(ben, actor));

    const { planId } = await createPlanViaUi(anna, { visibility: "public", title: "Hill repeats" });
    await test.runJobs();
    const create = delivered(test).find((sent) => sent.activity.type === "Create");
    const event = `https://${HOST}/p/${planId}`;
    expect(create?.url).toBe("https://social.example/inbox");
    expect(create?.activity).toMatchObject({
      actor,
      to: "as:Public",
      cc: `${actor}/followers`,
      object: {
        id: event,
        type: "Event",
        name: "Hill repeats",
        attributedTo: actor,
        to: "as:Public",
        cc: `${actor}/followers`,
      },
    });
    for (const secret of ["North gate", "48.16321", "11.60147"]) {
      expect(JSON.stringify(create?.activity)).not.toContain(secret);
    }
    // Fetched by its address, it is addressed as it was sent.
    const fetched = (await (await test.app.request(`/p/${planId}`, { headers: AP })).json()) as {
      to?: unknown;
    };
    expect(fetched.to).toBe("as:Public");
    // The host is told what narrowing would do.
    const hostPage = await (await anna.get(`/p/${planId}/host`)).text();
    expect(hostPage).toContain(
      `<p class="warning">${escaped(translator("en")("form.fediverseShared"))}</p>`,
    );

    await anna.postForm(`/p/${planId}/host/delete`, hiddenFields(hostPage));
    await test.runJobs();
    const gone = delivered(test).at(-1);
    expect(gone?.activity).toMatchObject({
      type: "Delete",
      actor,
      to: "as:Public",
      object: { type: "Tombstone", id: event },
    });
  });

  it("addresses followers plans to the followers, updates on cancel, and withdraws a public plan narrowed to followers", async () => {
    const oidc = new FakeOidcServer();
    const test = await createTestApp({ env: oidc.env(), oidc });
    const anna = new TestClient(test.app);
    const started = await anna.get("/login/oidc");
    const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), {
      sub: "anna",
      name: "Anna Müller",
    });
    await anna.get(`${callback.pathname}${callback.search}`);
    const csrf = (await anna.hiddenFields("/account"))._csrf ?? "";
    await anna.postForm("/account/profile", { _csrf: csrf, handle: "anna" });
    const finger = (await (
      await test.app.request(`/.well-known/webfinger?resource=acct:anna@${HOST}`)
    ).json()) as { links: { rel: string; href: string }[] };
    const actor = finger.links.find((link) => link.rel === "self")?.href ?? "";
    const ben = await remotePerson(test, "ben");
    await post(test, ben, followOf(ben, actor));
    const followers = `${actor}/followers`;

    const cancelled = (await createPlanViaUi(anna, { visibility: "followers", title: "Intervals" }))
      .planId;
    const hostPage = await (await anna.get(`/p/${cancelled}/host`)).text();
    await anna.postForm(`/p/${cancelled}/host/cancel`, hiddenFields(hostPage));
    await test.runJobs();
    const [create, update] = delivered(test).filter((sent) => sent.activity.type !== "Accept");
    expect(create?.activity).toMatchObject({
      type: "Create",
      to: followers,
      object: { type: "Event", to: followers },
    });
    expect(create?.activity).not.toHaveProperty("cc");
    expect(update?.activity).toMatchObject({
      type: "Update",
      actor,
      to: followers,
      object: {
        id: `https://${HOST}/p/${cancelled}`,
        name: translator("en")("preview.cancelled", { title: "Intervals" }),
      },
    });

    // Repeating a template of a public plan says where the new plan goes, before it does.
    const { planId } = await createPlanViaUi(anna, { visibility: "public" });
    const page = await (await anna.get(`/p/${planId}/host`)).text();
    const saveForm = page.slice(page.indexOf(`action="/p/${planId}/host/template"`));
    const saved = await (
      await anna.postForm(`/p/${planId}/host/template`, hiddenFields(saveForm))
    ).text();
    const templatePath = /href="(\/templates\/[^"]+)"/.exec(saved)?.[1] ?? "";
    expect(await (await anna.get(templatePath)).text()).toContain(
      escaped(translator("en")("template.repeatSharedPublic", { handle: `@anna@${HOST}` })),
    );

    // Narrowed to followers: withdrawn for good, and from then on not the actor's in the
    // fediverse, though it is still the followers' plan here.
    await anna.postForm(`/p/${planId}/host`, {
      ...(await editForm(anna, planId)),
      visibility: "followers",
    });
    await test.runJobs();
    expect(delivered(test).at(-1)?.activity).toMatchObject({
      type: "Delete",
      to: "as:Public",
      object: { type: "Tombstone", id: `https://${HOST}/p/${planId}` },
    });
    const event = (await (await test.app.request(`/p/${planId}`, { headers: AP })).json()) as {
      attributedTo?: unknown;
    };
    expect(event.attributedTo).toBe(INSTANCE);
    expect(await (await anna.get(`/p/${planId}/host`)).text()).toContain(
      escaped(translator("en")("form.fediverseWithdrawn")),
    );
  });
});
