// Remote participants through the inboxes (spec 7 ActivityPub, 3.7, 3.11; decision D42; 0.9 step
// 11a): a signed `Join` or `TentativeAccept` of a plan becomes a response and is answered with a
// signed `Accept` or `Reject` through the job queue; `Undo` and an actor's `Delete` remove it; a
// plan's `Update` and `Delete` reach these people whatever its visibility; unsigned, forged or
// foreign activities change nothing.
import { generateCryptoKeyPair, signRequest } from "@fedify/fedify";
import { describe, expect, it } from "vite-plus/test";
import { FakeOidcServer } from "../../fakes/oidc-server.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { isNoteActivity } from "../../support/remote-people.ts";
import { sampleGpx } from "../../support/gpx.ts";
import {
  createPlanViaUi,
  createPlanWithRouteViaUi,
  editForm,
  hostActsOn,
} from "../../support/plans.ts";

const HOST = "runs.example.org";
const INSTANCE = `https://${HOST}/actors/instance`;
const SECRETS = ["North gate", "48.16321", "11.60147"];

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Keys = Awaited<ReturnType<typeof generateCryptoKeyPair>>;
type Remote = { id: string; keys: Keys };

/** A remote person whose actor document the fake serves, with its own keys and inboxes. */
async function remotePerson(test: TestApp, name: string, server = "social.example") {
  const keys = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
  const id = `https://${server}/users/${name}`;
  const der = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${(der.toString("base64").match(/.{1,64}/g) ?? []).join("\n")}\n-----END PUBLIC KEY-----\n`;
  test.federationHttp.respond(id, {
    headers: { "content-type": "application/activity+json" },
    body: JSON.stringify({
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
      id,
      type: "Person",
      preferredUsername: name,
      name: `Display ${name}`,
      inbox: `https://${server}/users/${name}/inbox`,
      endpoints: { sharedInbox: `https://${server}/inbox` },
      publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: pem },
    }),
  });
  test.federationHttp.respond(`https://${server}/inbox`, { status: 202 });
  return { id, keys };
}

/** Many remote people of one server who share one key pair: generating keys is slow. */
async function crowd(test: TestApp, server: string, count: number) {
  const keys = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
  const der = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${(der.toString("base64").match(/.{1,64}/g) ?? []).join("\n")}\n-----END PUBLIC KEY-----\n`;
  test.federationHttp.respond(`https://${server}/inbox`, { status: 202 });
  return Array.from({ length: count }, (_, n): Remote => {
    const id = `https://${server}/users/c${n}`;
    test.federationHttp.respond(id, {
      headers: { "content-type": "application/activity+json" },
      body: JSON.stringify({
        "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
        id,
        type: "Person",
        preferredUsername: `c${n}`,
        inbox: `https://${server}/users/c${n}/inbox`,
        endpoints: { sharedInbox: `https://${server}/inbox` },
        publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: pem },
      }),
    });
    return { id, keys };
  });
}

/** Joins from `count` subdomains of one domain, one actor each, all signed with one key. */
async function joinFromSubdomains(test: TestApp, planId: string, count: number) {
  const keys = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
  const der = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${(der.toString("base64").match(/.{1,64}/g) ?? []).join("\n")}\n-----END PUBLIC KEY-----\n`;
  for (let n = 0; n < count; n++) {
    const id = `https://h${n}.example.org/users/u`;
    test.federationHttp.respond(id, {
      headers: { "content-type": "application/activity+json" },
      body: JSON.stringify({
        "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
        id,
        type: "Person",
        preferredUsername: "u",
        inbox: `${id}/inbox`,
        publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: pem },
      }),
    });
    await post(test, { id }, joinOf({ id }, planId), { id, keys });
  }
}

/** The host turns notifications on for the plan (push; the job queue then holds the notices). */
async function subscribeHost(host: TestClient, planId: string) {
  const token = (await host.hiddenFields("/new"))._csrf ?? "";
  await host.request(`/p/${planId}/host/notifications`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": token },
    body: JSON.stringify({
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        expirationTime: null,
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
      },
    }),
  });
}

/** The notices queued for the host, by kind. */
const hostNotices = async (test: TestApp) =>
  (await test.jobs.due(test.clock.now(), 1000)).flatMap((job) => {
    const notification = (job.payload as { notification?: { kind: string } }).notification;
    return notification === undefined ? [] : [notification.kind];
  });

const body = (from: { id: string }, activity: Record<string, unknown>) =>
  JSON.stringify({
    "@context": "https://www.w3.org/ns/activitystreams",
    actor: from.id,
    ...activity,
  });

/** Posts an activity to the shared inbox, signed by `signer` (the actor's own key by default). */
async function post(
  test: TestApp,
  from: { id: string },
  activity: Record<string, unknown>,
  signer: Remote = from as Remote,
) {
  const json = body(from, activity);
  const signed = await signRequest(
    new Request(`https://${HOST}/inbox`, {
      method: "POST",
      headers: { "content-type": "application/activity+json" },
      body: json,
    }),
    signer.keys.privateKey,
    new URL(`${signer.id}#main-key`),
  );
  return test.app.request("/inbox", { method: "POST", headers: signed.headers, body: json });
}

const joinOf = (from: { id: string }, planId: string, n = 1) => ({
  id: `${from.id}#join-${n}`,
  type: "Join",
  object: `https://${HOST}/p/${planId}`,
});
const leaveOf = (from: { id: string }, planId: string) => ({
  id: `${from.id}#leave-1`,
  type: "Leave",
  object: `https://${HOST}/p/${planId}`,
});
const tentativeOf = (from: { id: string }, planId: string) => ({
  id: `${from.id}#tentative-1`,
  type: "TentativeAccept",
  object: `https://${HOST}/p/${planId}`,
});

/** What the app delivered, but not the private Notes, which have their own tests (D43). */
const delivered = (test: TestApp) =>
  test.federationHttp.posts
    .map((sent) => ({
      url: sent.url.href,
      headers: sent.headers,
      activity: JSON.parse(new TextDecoder().decode(sent.body)) as Record<string, unknown>,
    }))
    .filter((sent) => !isNoteActivity(sent.activity));

const rows = (test: TestApp, table: string) =>
  JSON.stringify(test.database.sqlite.prepare(`select * from ${table}`).all());
const responseCount = (test: TestApp) =>
  Number(
    (test.database.sqlite.prepare("select count(*) as n from responses").get() as { n: number }).n,
  );

async function posterActor(test: TestApp, oidc: FakeOidcServer) {
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
  return { anna, actor: finger.links.find((link) => link.rel === "self")?.href ?? "" };
}

/** An app with a fake OIDC provider, for poster actors. */
async function appWithAccounts() {
  const oidc = new FakeOidcServer();
  return { test: await createTestApp({ env: oidc.env(), oidc }), oidc };
}

describe("a remote Join (decision D42)", () => {
  it("joins a link-only plan, stored encrypted, and is answered with a signed Accept from the instance actor", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const ben = await remotePerson(test, "ben");
    expect((await post(test, ben, joinOf(ben, planId))).status).toBe(202);
    // Nothing leaves with the request itself.
    expect(test.federationHttp.posts).toEqual([]);

    // The host sees the name; the database holds neither the address nor the name in the clear.
    expect(await (await host.get(`/p/${planId}/host`)).text()).toContain("ben@social.example");
    for (const table of ["responses", "job_queue"]) {
      expect(rows(test, table)).not.toContain("social.example");
      expect(rows(test, table)).not.toContain("ben@");
    }
    // Fedify notes the processed activity under a keyed hash: no address in its records (the
    // cache of the signers' public keys, which Fedify keeps, holds key ids and is not checked).
    const records = (
      test.database.sqlite.prepare("select key, value from fedify_kv").all() as {
        key: string;
        value: string;
      }[]
    ).filter((row) => row.key.includes("activityIdempotence"));
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain("social.example");
    expect(JSON.stringify(records)).not.toContain("join-1");
    await test.runJobs();
    const [accept, ...more] = delivered(test);
    expect(more).toEqual([]);
    expect(accept?.url).toBe("https://social.example/inbox");
    expect(accept?.headers.signature).toContain(`keyId="${INSTANCE}#main-key"`);
    expect(accept?.activity).toMatchObject({
      type: "Accept",
      actor: INSTANCE,
      to: ben.id,
      object: {
        id: `${ben.id}#join-1`,
        type: "Join",
        actor: ben.id,
        object: `https://${HOST}/p/${planId}`,
      },
    });
    // The plan page counts a participant.
    expect(await (await host.get(`/p/${planId}`)).text()).toContain("ben@social.example");
  });

  it("takes a TentativeAccept as interested and answers with Accept wrapping it", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const cleo = await remotePerson(test, "cleo", "other.example");
    await post(test, cleo, tentativeOf(cleo, planId));
    await test.runJobs();
    const [answer] = delivered(test);
    expect(answer?.url).toBe("https://other.example/inbox");
    expect(answer?.activity).toMatchObject({
      type: "Accept",
      object: { id: `${cleo.id}#tentative-1`, type: "TentativeAccept" },
    });
    const counts = test.database.sqlite.prepare("select kind from responses").all() as {
      kind: string;
    }[];
    expect(counts).toEqual([{ kind: "interested" }]);
  });

  it("makes a request in approval mode: no Accept until the host accepts, Reject when it rejects", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, { joinMode: "approval" });
    const dan = await remotePerson(test, "dan");
    const eve = await remotePerson(test, "eve", "other.example");
    await post(test, dan, joinOf(dan, planId));
    await post(test, eve, joinOf(eve, planId));
    await test.runJobs();
    expect(test.federationHttp.posts).toEqual([]);
    expect(
      test.database.sqlite.prepare("select kind from responses").all() as { kind: string }[],
    ).toEqual([{ kind: "requested" }, { kind: "requested" }]);

    expect((await hostActsOn(host, planId, "accept", "dan@social.example")).status).toBe(303);
    await test.runJobs();
    expect(delivered(test).map((sent) => [sent.url, sent.activity.type])).toEqual([
      ["https://social.example/inbox", "Accept"],
    ]);
    expect(delivered(test)[0]?.activity).toMatchObject({ object: { id: `${dan.id}#join-1` } });

    await hostActsOn(host, planId, "reject", "eve@other.example");
    await test.runJobs();
    expect(delivered(test).at(-1)?.url).toBe("https://other.example/inbox");
    expect(delivered(test).at(-1)?.activity).toMatchObject({
      type: "Reject",
      actor: INSTANCE,
      to: eve.id,
      object: { id: `${eve.id}#join-1`, type: "Join" },
    });
    // Rejected for good: joining again is rejected, not stored.
    await post(test, eve, joinOf(eve, planId, 2));
    await test.runJobs();
    expect(delivered(test).at(-1)?.activity).toMatchObject({
      type: "Reject",
      object: { id: `${eve.id}#join-2` },
    });
    expect(responseCount(test)).toBe(2);
  });

  it("rejects a Join of a cancelled plan and of one that has started, and stores nothing", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const cancelled = (await createPlanViaUi(host, {})).planId;
    await host.postForm(
      `/p/${cancelled}/host/cancel`,
      hiddenFields(await (await host.get(`/p/${cancelled}/host`)).text()),
    );
    const started = (await createPlanViaUi(host, {})).planId;
    const fay = await remotePerson(test, "fay");
    const gus = await remotePerson(test, "gus", "other.example");
    await post(test, fay, joinOf(fay, cancelled));
    // Delivered before the clock jumps: queued activities expire after 12 hours.
    await test.runJobs();
    test.clock.set("2026-06-08T00:00:00Z");
    await post(test, gus, joinOf(gus, started));
    await test.runJobs();
    expect(delivered(test).map((sent) => [sent.url, sent.activity.type])).toEqual([
      ["https://social.example/inbox", "Reject"],
      ["https://other.example/inbox", "Reject"],
    ]);
    expect(delivered(test)[1]?.activity).toMatchObject({ object: { type: "Join", actor: gus.id } });
    expect(responseCount(test)).toBe(0);
  });

  it("is idempotent for a repeated Join", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const hal = await remotePerson(test, "hal");
    await post(test, hal, joinOf(hal, planId));
    await post(test, hal, joinOf(hal, planId));
    expect(responseCount(test)).toBe(1);
    const html = await (await host.get(`/p/${planId}/host`)).text();
    expect(html.split("hal@social.example").length - 1).toBe(1);
  });

  it("ignores a Join of an unknown plan, of something else, and of another server's plan", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const ivy = await remotePerson(test, "ivy");
    for (const object of [
      `https://${HOST}/p/${"x".repeat(22)}`,
      INSTANCE,
      `https://evil.example/p/${planId}`,
      `https://${HOST}/inbox`,
    ]) {
      await post(test, ivy, { id: `${ivy.id}#join-${object.length}`, type: "Join", object });
    }
    await test.runJobs();
    expect(responseCount(test)).toBe(0);
    expect(test.federationHttp.posts).toEqual([]);
  });

  it("changes nothing for an unsigned Join, one signed by someone else, or one whose actor is not the signer", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const ben = await remotePerson(test, "ben");
    // On the same server, so only the signature stands between mallory and ben's name.
    const mallory = await remotePerson(test, "mallory");
    const forged = await post(test, ben, joinOf(ben, planId), mallory);
    expect(forged.status).toBe(401);
    const unsigned = await test.app.request("/inbox", {
      method: "POST",
      headers: { "content-type": "application/activity+json" },
      body: body(ben, joinOf(ben, planId)),
    });
    expect(unsigned.status).toBe(401);
    // Signed with another key under ben's own key id.
    const stranger = { id: ben.id, keys: await generateCryptoKeyPair("RSASSA-PKCS1-v1_5") };
    expect((await post(test, ben, joinOf(ben, planId), stranger)).status).toBe(401);
    await test.runJobs();
    expect(responseCount(test)).toBe(0);
    expect(test.federationHttp.posts).toEqual([]);
  });

  it("does nothing while federation is off", async () => {
    const test = await createTestApp({ env: { FEDERATION_ENABLED: "false" } });
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const ben = await remotePerson(test, "ben");
    expect((await post(test, ben, joinOf(ben, planId))).status).toBeGreaterThanOrEqual(400);
    await test.runJobs();
    expect(responseCount(test)).toBe(0);
    expect(test.federationHttp.posts).toEqual([]);
  });
});

describe("leaving and being deleted", () => {
  it("removes the response on the actor's own Undo, not on someone else's", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const jon = await remotePerson(test, "jon");
    const mallory = await remotePerson(test, "mallory");
    await post(test, jon, joinOf(jon, planId));
    await post(test, mallory, joinOf(mallory, planId));
    const undo = (by: { id: string }, of: { id: string }) => ({
      id: `${by.id}#undo-1`,
      type: "Undo",
      object: { ...joinOf(of, planId), actor: of.id },
    });
    await post(test, mallory, undo(mallory, jon));
    expect(responseCount(test)).toBe(2);
    await post(test, jon, undo(jon, jon));
    expect(responseCount(test)).toBe(1);
    // An interested actor undoes its TentativeAccept the same way.
    const kim = await remotePerson(test, "kim");
    await post(test, kim, tentativeOf(kim, planId));
    await post(test, kim, {
      id: `${kim.id}#undo-2`,
      type: "Undo",
      object: { ...tentativeOf(kim, planId), actor: kim.id },
    });
    expect(responseCount(test)).toBe(1);
  });

  it("ignores an Undo whose embedded Join names someone else, even one the signer made", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const ben = await remotePerson(test, "ben");
    const mallory = await remotePerson(test, "mallory");
    await post(test, mallory, joinOf(mallory, planId));
    await post(test, ben, joinOf(ben, planId, 2));
    // Mallory undoes her own Join's identifier, but says it was Ben's: nothing of anyone's goes.
    await post(test, mallory, {
      id: `${mallory.id}#undo-1`,
      type: "Undo",
      object: { ...joinOf(mallory, planId), actor: ben.id },
    });
    expect(responseCount(test)).toBe(2);
  });

  it("removes everything of an actor that deletes itself, in every plan, and its follow; not for others' Delete", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const first = (await createPlanViaUi(host, { title: "First" })).planId;
    const second = (await createPlanViaUi(host, { title: "Second" })).planId;
    const lea = await remotePerson(test, "lea");
    const mallory = await remotePerson(test, "mallory");
    await post(test, lea, joinOf(lea, first));
    await post(test, lea, tentativeOf(lea, second));
    await post(test, lea, { id: `${lea.id}#follow`, type: "Follow", object: INSTANCE });
    await post(test, mallory, joinOf(mallory, first));
    expect(responseCount(test)).toBe(3);
    const followers = async () =>
      (
        (await (
          await test.app.request("/actors/instance/followers", {
            headers: { accept: "application/activity+json" },
          })
        ).json()) as { totalItems: number }
      ).totalItems;
    expect(await followers()).toBe(1);

    await post(test, mallory, { id: `${mallory.id}#delete`, type: "Delete", object: lea.id });
    expect(responseCount(test)).toBe(3);
    await post(test, lea, { id: `${lea.id}#delete`, type: "Delete", object: lea.id });
    expect(responseCount(test)).toBe(1);
    expect(await followers()).toBe(0);
    expect(await (await host.get(`/p/${first}/host`)).text()).not.toContain("lea@social.example");
  });

  it("believes an unverifiable Delete of an actor its server says is gone", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const max = await remotePerson(test, "max");
    await post(test, max, joinOf(max, planId));
    const other = { id: max.id, keys: await generateCryptoKeyPair("RSASSA-PKCS1-v1_5") };
    const deleteSelf = { id: `${max.id}#delete`, type: "Delete", object: max.id };
    expect((await post(test, max, deleteSelf, other)).status).toBe(401);
    expect(responseCount(test)).toBe(1);
    test.federationHttp.respond(max.id, { status: 410 });
    expect((await post(test, max, deleteSelf, other)).status).toBe(202);
    expect(responseCount(test)).toBe(0);
  });
});

describe("what reaches remote participants (decision D42)", () => {
  it("sends a link-only plan's Update and its Delete from the instance actor, public fields only", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const ben = await remotePerson(test, "ben");
    await post(test, ben, joinOf(ben, planId));
    await test.runJobs();
    test.federationHttp.posts.length = 0;

    await host.postForm(`/p/${planId}/host`, {
      ...(await editForm(host, planId)),
      title: "Hill repeats",
    });
    await test.runJobs();
    const [update, ...more] = delivered(test);
    expect(more).toEqual([]);
    expect(update?.url).toBe("https://social.example/inbox");
    expect(update?.headers.signature).toContain(`keyId="${INSTANCE}#main-key"`);
    expect(update?.activity).toMatchObject({
      type: "Update",
      actor: INSTANCE,
      to: ben.id,
      object: {
        id: `https://${HOST}/p/${planId}`,
        type: "Event",
        name: "Hill repeats",
        attributedTo: INSTANCE,
      },
    });

    const page = await (await host.get(`/p/${planId}/host`)).text();
    await host.postForm(`/p/${planId}/host/delete`, hiddenFields(page));
    await test.runJobs();
    // The plan, its response and its undelivered jobs are gone; the Delete outlives them.
    expect(responseCount(test)).toBe(0);
    expect(delivered(test).at(-1)?.activity).toMatchObject({
      type: "Delete",
      actor: INSTANCE,
      to: ben.id,
      object: { type: "Tombstone", id: `https://${HOST}/p/${planId}` },
    });
    for (const sent of delivered(test)) {
      for (const secret of SECRETS) expect(JSON.stringify(sent.activity)).not.toContain(secret);
    }
  });

  it("sends a shared plan's Update and Delete from the poster's actor, to participants beyond the followers", async () => {
    const { test, oidc } = await appWithAccounts();
    const { anna, actor } = await posterActor(test, oidc);
    const ben = await remotePerson(test, "ben");
    const cleo = await remotePerson(test, "cleo", "other.example");
    await post(test, ben, { id: `${ben.id}#follow`, type: "Follow", object: actor });
    const { planId } = await createPlanViaUi(anna, { visibility: "public", title: "Shared run" });
    await post(test, cleo, joinOf(cleo, planId));
    await post(test, ben, joinOf(ben, planId));
    await test.runJobs();
    test.federationHttp.posts.length = 0;

    await anna.postForm(`/p/${planId}/host`, {
      ...(await editForm(anna, planId)),
      title: "Hill repeats",
    });
    await test.runJobs();
    // Ben's server gets the followers' Update and Ben's own; Cleo's server only Cleo's.
    const updates = delivered(test).map((sent) => ({
      url: sent.url,
      to: sent.activity.to,
      json: JSON.stringify(sent.activity),
    }));
    expect(updates.map((sent) => `${sent.url} ${String(sent.to)}`).sort()).toEqual(
      [
        `https://other.example/inbox ${cleo.id}`,
        `https://social.example/inbox ${ben.id}`,
        "https://social.example/inbox as:Public",
      ].sort(),
    );
    // Nobody is named in what is sent to others: not Ben to Cleo's server, not Cleo to Ben's.
    const toCleo = updates.filter((sent) => sent.url.startsWith("https://other.example"));
    const toBen = updates.filter((sent) => sent.url.startsWith("https://social.example"));
    expect(toCleo.map((sent) => sent.json).join()).not.toContain(ben.id);
    expect(toBen.map((sent) => sent.json).join()).not.toContain(cleo.id);
    for (const sent of delivered(test)) {
      expect(sent.headers.signature).toContain(`keyId="${actor}#main-key"`);
      expect(sent.activity).toMatchObject({ actor, object: { name: "Hill repeats" } });
    }

    test.federationHttp.posts.length = 0;
    await anna.postForm(
      `/p/${planId}/host/delete`,
      hiddenFields(await (await anna.get(`/p/${planId}/host`)).text()),
    );
    await test.runJobs();
    expect(
      delivered(test)
        .map((sent) => `${sent.url} ${String(sent.activity.type)} ${String(sent.activity.to)}`)
        .sort(),
    ).toEqual(
      [
        `https://other.example/inbox Delete ${cleo.id}`,
        `https://social.example/inbox Delete ${ben.id}`,
        "https://social.example/inbox Delete as:Public",
      ].sort(),
    );
    for (const sent of delivered(test)) {
      expect(sent.activity).toMatchObject({
        actor,
        object: { type: "Tombstone", id: `https://${HOST}/p/${planId}` },
      });
      for (const secret of SECRETS) expect(JSON.stringify(sent.activity)).not.toContain(secret);
    }
  });
});

describe("addressed to each participant alone (spec 3.6, decision D42)", () => {
  it("sends a link-only plan's Update and Delete to each participant on its own server, naming nobody else", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const ben = await remotePerson(test, "ben");
    const cleo = await remotePerson(test, "cleo", "other.example");
    const dora = await remotePerson(test, "dora", "third.example");
    await post(test, ben, joinOf(ben, planId));
    await post(test, cleo, joinOf(cleo, planId));
    await post(test, dora, tentativeOf(dora, planId));
    await test.runJobs();
    test.federationHttp.posts.length = 0;
    const people = [ben, cleo, dora];

    const expectEachAlone = (type: string) => {
      const sent = delivered(test).filter((item) => item.activity.type === type);
      expect(sent).toHaveLength(3);
      for (const person of people) {
        const own = sent.filter((item) => item.activity.to === person.id);
        expect(own).toHaveLength(1);
        expect(own[0]?.url).toBe(`https://${new URL(person.id).host}/inbox`);
        // The body names this person and no other participant, nor their servers.
        const json = JSON.stringify(own[0]?.activity);
        for (const other of people.filter((candidate) => candidate !== person)) {
          expect(json).not.toContain(other.id);
          expect(json).not.toContain(new URL(other.id).host);
        }
      }
    };
    await host.postForm(`/p/${planId}/host`, {
      ...(await editForm(host, planId)),
      title: "Hill repeats",
    });
    await test.runJobs();
    expectEachAlone("Update");

    test.federationHttp.posts.length = 0;
    await host.postForm(
      `/p/${planId}/host/delete`,
      hiddenFields(await (await host.get(`/p/${planId}/host`)).text()),
    );
    await test.runJobs();
    expectEachAlone("Delete");
  });
});

describe("a remote Leave", () => {
  it("removes the actor's own response; a forged or foreign one changes nothing", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const other = (await createPlanViaUi(host, { title: "Other" })).planId;
    const ben = await remotePerson(test, "ben");
    const mallory = await remotePerson(test, "mallory");
    await post(test, ben, joinOf(ben, planId));
    await post(test, ben, joinOf(ben, other, 2));
    // Signed by someone on the same server, in ben's name: refused.
    expect((await post(test, ben, leaveOf(ben, planId), mallory)).status).toBe(401);
    // Mallory's own Leave takes nothing of Ben's; a plan of another server, or none, nothing.
    await post(test, mallory, leaveOf(mallory, planId));
    for (const object of [`https://evil.example/p/${planId}`, INSTANCE]) {
      await post(test, ben, { id: `${ben.id}#leave-x${object.length}`, type: "Leave", object });
    }
    expect(responseCount(test)).toBe(2);
    await post(test, ben, leaveOf(ben, planId));
    expect(responseCount(test)).toBe(1);
    expect(await (await host.get(`/p/${planId}/host`)).text()).not.toContain("ben@social.example");
    expect(await (await host.get(`/p/${other}/host`)).text()).toContain("ben@social.example");
  });
});

describe("limits on remote joins (spec 3.11, decision D42)", () => {
  it("takes only a burst of Joins from one server, refuses the rest to be tried again, and leaves other servers alone", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    await subscribeHost(host, planId);
    const noisy = await crowd(test, "noisy.example", 30);
    const statuses: number[] = [];
    for (const [n, actor] of noisy.entries()) {
      statuses.push((await post(test, actor, joinOf(actor, planId, n))).status);
    }
    // As many as the web may respond in a burst (10); the rest is refused with a failure, not
    // answered "accepted", so the sending server tries again later.
    expect(responseCount(test)).toBe(10);
    expect(statuses.filter((status) => status === 202)).toHaveLength(10);
    expect(statuses.slice(10).every((status) => status >= 500)).toBe(true);
    expect(await hostNotices(test)).toHaveLength(10);
    await test.runJobs();
    expect(delivered(test)).toHaveLength(10);
    const quiet = await remotePerson(test, "ben", "quiet.example");
    await post(test, quiet, joinOf(quiet, planId));
    expect(responseCount(test)).toBe(11);

    // The refused Join was not recorded as processed: once the bucket refills, it is taken.
    const [late] = noisy.slice(10);
    if (late === undefined) throw new Error("no refused actor");
    test.clock.set(new Date(test.clock.now().getTime() + 2 * 60 * 60 * 1000).toISOString());
    expect((await post(test, late, joinOf(late, planId, 10))).status).toBe(202);
    expect(responseCount(test)).toBe(12);
  });

  it("tells the host once of an actor who flips between answers", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    await subscribeHost(host, planId);
    const ben = await remotePerson(test, "ben");
    await post(test, ben, joinOf(ben, planId, 1));
    await post(test, ben, { ...tentativeOf(ben, planId), id: `${ben.id}#t-2` });
    await post(test, ben, joinOf(ben, planId, 3));
    await post(test, ben, { ...tentativeOf(ben, planId), id: `${ben.id}#t-4` });
    await post(test, ben, joinOf(ben, planId, 5));
    expect(await hostNotices(test)).toEqual(["newResponse"]);
    expect(responseCount(test)).toBe(1);
  });

  it("tells the host of a request after an earlier interest, once per kind however often the actor flips", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, { joinMode: "approval" });
    await subscribeHost(host, planId);
    const ben = await remotePerson(test, "ben");
    await post(test, ben, { ...tentativeOf(ben, planId), id: `${ben.id}#t-1` });
    await post(test, ben, joinOf(ben, planId, 2));
    for (const n of [3, 5, 7]) {
      await post(test, ben, { ...tentativeOf(ben, planId), id: `${ben.id}#t-${n}` });
      await post(test, ben, joinOf(ben, planId, n + 1));
    }
    expect(await hostNotices(test)).toEqual(["newResponse", "newRequest"]);
  });

  it("tells the host of at most 20 joins an hour to a plan, however many servers they come from", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    await subscribeHost(host, planId);
    // Each subdomain is another origin, so the per-server limit does not stop them.
    await joinFromSubdomains(test, planId, 30);
    // Every join is stored; the host hears of the first 20 only.
    expect(responseCount(test)).toBe(30);
    expect(await hostNotices(test)).toHaveLength(20);
  });

  it("spends an actor's notice only when the notice is sent, not when the plan's cap refuses it", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    await subscribeHost(host, planId);
    await joinFromSubdomains(test, planId, 20);
    expect(await hostNotices(test)).toHaveLength(20);
    // The plan's cap is used up: Ben's Join is stored, the host is not told.
    const ben = await remotePerson(test, "ben");
    await post(test, ben, joinOf(ben, planId, 1));
    await post(test, ben, { ...tentativeOf(ben, planId), id: `${ben.id}#t-2` });
    expect(await hostNotices(test)).toHaveLength(20);
    // Later in the hour the cap has room again, and Ben's first notice of that kind is still his.
    test.clock.set(new Date(test.clock.now().getTime() + 10 * 60 * 1000).toISOString());
    await post(test, ben, joinOf(ben, planId, 3));
    expect(await hostNotices(test)).toHaveLength(21);
  });

  it("refuses a server over its limit before fetching its actor, and still ignores inboxes on another server", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    const noisy = await crowd(test, "noisy.example", 14);
    const fetches = (actor: Remote) =>
      test.federationHttp.requests.filter((url) => url.href === actor.id).length;
    const statuses: number[] = [];
    const costs: number[] = [];
    for (const [n, actor] of noisy.entries()) {
      const before = fetches(actor);
      statuses.push((await post(test, actor, joinOf(actor, planId, n))).status);
      costs.push(fetches(actor) - before);
    }
    expect(statuses.slice(0, 10).every((status) => status === 202)).toBe(true);
    expect(statuses.slice(10).every((status) => status >= 500)).toBe(true);
    // Fedify's check that the key belongs to the actor fetches the actor document once; the
    // listener's own fetch of the actor comes on top only where the Join is allowed to go on.
    expect(costs.slice(0, 10)).toEqual(Array<number>(10).fill(2));
    expect(costs.slice(10)).toEqual([1, 1, 1, 1]);
    expect(responseCount(test)).toBe(10);

    // An actor whose inbox is on another server is still ignored, as before.
    const keys = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
    const der = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey));
    const pem = `-----BEGIN PUBLIC KEY-----\n${(der.toString("base64").match(/.{1,64}/g) ?? []).join("\n")}\n-----END PUBLIC KEY-----\n`;
    const id = "https://elsewhere.example/users/eve";
    test.federationHttp.respond(id, {
      headers: { "content-type": "application/activity+json" },
      body: JSON.stringify({
        "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
        id,
        type: "Person",
        preferredUsername: "eve",
        inbox: "https://victim.example/inbox",
        publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: pem },
      }),
    });
    expect((await post(test, { id }, joinOf({ id }, planId), { id, keys })).status).toBe(202);
    expect(responseCount(test)).toBe(10);
    await test.runJobs();
    expect(delivered(test).every((sent) => !sent.url.includes("victim.example"))).toBe(true);
  });
});

describe("when the profile that shared the plan is retired (decisions D36, D37, D42, D43)", () => {
  /** A public plan of Anna's with a follower (Ben) and a participant who does not follow (Cleo). */
  async function sharedPlan() {
    const { test, oidc } = await appWithAccounts();
    const { anna, actor } = await posterActor(test, oidc);
    const ben = await remotePerson(test, "ben");
    const cleo = await remotePerson(test, "cleo", "other.example");
    await post(test, ben, { id: `${ben.id}#follow`, type: "Follow", object: actor });
    const { planId } = await createPlanViaUi(anna, { visibility: "public", title: "Shared run" });
    await post(test, cleo, joinOf(cleo, planId));
    await test.runJobs();
    test.federationHttp.posts.length = 0;
    return { test, anna, actor, planId, ben, cleo };
  }

  const turnOff = async (anna: TestClient) =>
    anna.postForm("/account/profile/off", {
      _csrf: (await anna.hiddenFields("/account"))._csrf ?? "",
    });
  const deleteAccount = async (anna: TestClient) =>
    anna.postForm(
      "/account/delete",
      hiddenFields(await (await anna.get("/account/delete")).text()),
    );

  it.each([
    ["the profile is turned off", turnOff],
    ["the account is deleted", deleteAccount],
  ])("signs what is queued when %s, though its keys are gone by delivery", async (_how, retire) => {
    const { test, anna, actor, cleo } = await sharedPlan();
    await retire(anna);
    // Delivered only now, after the keys are dropped.
    await test.runJobs();
    const sent = test.federationHttp.posts.map((post) => ({
      url: post.url.href,
      headers: post.headers,
      text: new TextDecoder().decode(post.body),
      activity: JSON.parse(new TextDecoder().decode(post.body)) as Record<string, unknown>,
    }));
    // Everything that goes out is signed by an actor that can still be verified: the retired one's
    // key travels in its job, the instance's is in the key directory.
    expect(sent.length).toBeGreaterThanOrEqual(2);
    for (const item of sent) {
      expect(item.headers.signature).toMatch(new RegExp(`keyId="(${actor}|${INSTANCE})#main-key"`));
    }
    // The actor's Delete reaches the follower's server, and Cleo, who does not follow, learns
    // that the Note and the plan's Event are withdrawn.
    expect(
      sent.some((item) => item.activity.type === "Delete" && item.activity.object === actor),
    ).toBe(true);
    const toCleo = sent.filter((item) => item.url === "https://other.example/inbox");
    expect(toCleo.map((item) => item.activity.type)).toContain("Delete");
    expect(toCleo.every((item) => item.activity.to === cleo.id)).toBe(true);
    expect(toCleo.some((item) => isNoteActivity(item.activity))).toBe(true);
    // The key is in the encrypted payload only: not in the clear in the queue before delivery.
    for (const item of sent) {
      expect(item.text).not.toContain("PRIVATE KEY");
      // Nor a private key as a JWK: its `d` member.
      expect(item.text).not.toMatch(/"d"\s*:/);
    }
  });

  it("sends the plan's own Delete to a participant who does not follow, from a key that can still sign, when the account is deleted", async () => {
    const { test, anna, actor, planId, cleo } = await sharedPlan();
    await deleteAccount(anna);
    await test.runJobs();
    const eventDeletes = test.federationHttp.posts
      .map((post) => ({
        url: post.url.href,
        signature: post.headers.signature ?? "",
        activity: JSON.parse(new TextDecoder().decode(post.body)) as Record<string, unknown>,
      }))
      .filter(
        (item) =>
          item.activity.type === "Delete" &&
          (item.activity.object as { id?: string } | undefined)?.id ===
            `https://${HOST}/p/${planId}`,
      );
    // Once, to Cleo only (the followers have the actor's own Delete), and not from the retired
    // actor, whose job would reach a server with a key that is no longer published.
    expect(eventDeletes.map((item) => item.url)).toEqual(["https://other.example/inbox"]);
    expect(eventDeletes[0]?.activity.to).toBe(cleo.id);
    expect(eventDeletes[0]?.signature).toContain(`keyId="${INSTANCE}#main-key"`);
    expect(eventDeletes[0]?.signature).not.toContain(actor);
  });

  it("gives a joined participant a new Note from the instance, and its link, when the profile is turned off", async () => {
    const { test, oidc } = await appWithAccounts();
    const { anna, actor } = await posterActor(test, oidc);
    const cleo = await remotePerson(test, "cleo", "other.example");
    const { planId } = await createPlanWithRouteViaUi(
      anna,
      { visibility: "public", title: "Shared run" },
      sampleGpx({ lat: 47.31313 }),
    );
    await post(test, cleo, joinOf(cleo, planId));
    await test.runJobs();
    const notesTo = (type: string) =>
      test.federationHttp.posts
        .map((post) => JSON.parse(new TextDecoder().decode(post.body)) as Record<string, unknown>)
        .filter((activity) => activity.type === type && isNoteActivity(activity));
    const link = (activity: Record<string, unknown> | undefined) =>
      /\/federation\/notes\/([^/]+)\/route\.gpx/.exec(JSON.stringify(activity))?.[1] ?? "";
    const oldCreate = notesTo("Create")[0];
    const oldToken = link(oldCreate);
    expect((await test.app.request(`/federation/notes/${oldToken}/route.gpx`)).status).toBe(200);
    test.federationHttp.posts.length = 0;

    await turnOff(anna);
    await test.runJobs();
    // The old Note is withdrawn by the profile, with its key carried; a new one comes from the
    // instance, and the link in it works while the old link does not.
    const [gone] = notesTo("Delete");
    const [fresh] = notesTo("Create");
    const noteId = (activity: Record<string, unknown> | undefined) =>
      String((activity?.object as { id?: string } | undefined)?.id);
    expect(JSON.stringify(gone)).toContain(noteId(oldCreate));
    expect(gone).toMatchObject({ actor, to: cleo.id });
    expect(fresh).toMatchObject({ actor: INSTANCE, to: cleo.id });
    expect(noteId(fresh)).not.toBe(noteId(oldCreate));
    const freshToken = link(fresh);
    expect(freshToken).not.toBe("");
    expect(freshToken).not.toBe(oldToken);
    expect((await test.app.request(`/federation/notes/${oldToken}/route.gpx`)).status).toBe(404);
    const served = await test.app.request(`/federation/notes/${freshToken}/route.gpx`);
    expect(served.status).toBe(200);
    expect(await served.text()).toContain('lat="47.31313"');
  });

  it("keeps the carried key out of the queue's plaintext", async () => {
    const { test, anna } = await sharedPlan();
    await turnOff(anna);
    expect(rows(test, "job_queue")).not.toContain("PRIVATE KEY");
    expect(rows(test, "job_queue")).not.toContain('"d"');
    const queued = await test.jobs.due(test.clock.now(), 100);
    // At least one job carries a key, in the encrypted payload that only the job runner reads.
    expect(
      queued.some((job) => (job.payload as { privateKey?: unknown }).privateKey !== undefined),
    ).toBe(true);
    expect(
      JSON.stringify(test.database.sqlite.prepare("select last_error from job_queue").all()),
    ).not.toContain('"d"');
  });
});
