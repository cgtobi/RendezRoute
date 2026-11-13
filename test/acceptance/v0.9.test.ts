// v0.9 acceptance criteria for federation (spec 7, released as 0.9 by decision D21), one test named
// after each (spec 2b definition of done), through the web pages and the inboxes with federation
// on: every request to every remote server is captured by the fake outbound HTTP.
import { generateCryptoKeyPair, signRequest } from "@fedify/fedify";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Database } from "../../src/adapters/out/sqlite/database.ts";
import { FakeOidcServer } from "../fakes/oidc-server.ts";
import { createTestApp } from "../support/app.ts";
import { hiddenFields, TestClient } from "../support/client.ts";
import { sampleGpx } from "../support/gpx.ts";
import { createPlanViaUi, createPlanWithRouteViaUi, hostActsOn } from "../support/plans.ts";
import {
  delivered,
  HOST,
  INSTANCE,
  isNoteActivity,
  joinOf,
  post,
  remotePerson,
  type Remote,
  type TestApp,
} from "../support/remote-people.ts";

// Making RSA keys for the impostors is slow when the whole suite runs at once.
vi.setConfig({ testTimeout: 60_000 });

const AP = { accept: "application/activity+json" };
const AFTER_START = "2026-06-07T06:00:00Z";
const planUri = (planId: string) => `https://${HOST}/p/${planId}`;

/** The well-behaved remote people share one pair of keys: generating RSA keys is slow. */
let sharedKeys: Promise<Remote["keys"]> | undefined;
const person = async (test: TestApp, name: string, server: string) =>
  remotePerson(
    test,
    name,
    server,
    await (sharedKeys ??= generateCryptoKeyPair("RSASSA-PKCS1-v1_5")),
  );

/** Every row of every table, to compare before and after (numbers included, not only text). */
function snapshot(database: Database, ignore: readonly string[] = []): string {
  const tables = database.sqlite
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all() as { name: string }[];
  return JSON.stringify(
    tables
      .filter(({ name }) => !ignore.includes(name))
      .map(({ name }) => [name, database.sqlite.prepare(`select * from "${name}"`).all()]),
  );
}

/** Fedify's own cache of keys it fetched and of activity ids it has seen: not the app's state. */
const CACHE = ["fedify_kv"];

/** The addresses of a `to` that may be one string or a list. */
const addresses = (value: unknown): string[] =>
  value === undefined
    ? []
    : Array.isArray(value)
      ? value.map((item) => JSON.stringify(item).replace(/^"|"$/g, ""))
      : [JSON.stringify(value).replace(/^"|"$/g, "")];

/** A private reply Note from a joined remote participant, as a Mastodon-like server posts it. */
const replyOf = (from: { id: string }, planId: string, content: string, n = 1) => ({
  id: `${from.id}/statuses/${n}/activity`,
  type: "Create",
  to: [INSTANCE],
  cc: [],
  object: {
    id: `${from.id}/statuses/${n}`,
    type: "Note",
    attributedTo: from.id,
    inReplyTo: planUri(planId),
    to: [INSTANCE],
    cc: [],
    content,
    published: "2026-06-07T07:00:00Z",
  },
});

const followOf = (from: { id: string }, object: string, n = 1) => ({
  id: `${from.id}#follow-${n}`,
  type: "Follow",
  object,
});

describe("v0.9 acceptance criteria (spec 7)", () => {
  it("Exact start, route and recap contributions never reach any remote server except as direct messages to accepted remote participants, and deleting a plan sends `Delete` for every one of them", async () => {
    const START = "Kiosk by the river weir";
    const LAT = "48.20417";
    const LNG = "11.70123";
    const GPX_LAT = "47.11111";
    // The longitude every point of `sampleGpx` has.
    const GPX_LNG = "10.98765";
    const HOST_TEXT = "Quokka-host-words-7731";
    const REPLY_TEXT = "Quokka-reply-words-7732";

    const oidc = new FakeOidcServer();
    const test = await createTestApp({ env: oidc.env(), oidc });

    // The host: logged in, with a fediverse profile.
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
    const posterActor = finger.links.find((link) => link.rel === "self")?.href ?? "";
    expect(posterActor).toContain("/actors/");

    // Remote people, each on a server of their own: A and A2 will be accepted, B stays pending,
    // C is rejected, and F follows the host without ever joining.
    const a = await person(test, "alice", "accepted.example");
    const a2 = await person(test, "amy", "accepted2.example");
    const b = await person(test, "bob", "pending.example");
    const c = await person(test, "carl", "rejected.example");
    const f = await person(test, "fay", "follower.example");
    await post(test, f, followOf(f, posterActor));

    // A public plan, shared to the followers, with an exact start, a route and approval.
    const { planId } = await createPlanWithRouteViaUi(
      anna,
      {
        visibility: "public",
        joinMode: "approval",
        exactDescription: START,
        exactLat: LAT,
        exactLng: LNG,
        distanceKm: "",
      },
      sampleGpx({ lat: Number(GPX_LAT) }),
    );
    for (const who of [a, a2, b, c]) await post(test, who, joinOf(who, planId));
    for (const name of ["alice@accepted.example", "amy@accepted2.example"]) {
      expect((await hostActsOn(anna, planId, "accept", name)).status).toBe(303);
    }
    expect((await hostActsOn(anna, planId, "reject", "carl@rejected.example")).status).toBe(303);
    await test.runJobs();

    // After the start: a contribution by the host, and a private signed reply from A.
    test.clock.set(AFTER_START);
    const csrf = hiddenFields(await (await anna.get(`/p/${planId}`)).text())._csrf ?? "";
    expect(
      (await anna.postForm(`/p/${planId}/recap`, { _csrf: csrf, body: HOST_TEXT, linkUrl: "" }))
        .status,
    ).toBeLessThan(400);
    expect((await post(test, a, replyOf(a, planId, `<p>${REPLY_TEXT}</p>`))).status).toBe(202);
    await test.runJobs();

    // The secrets: the exact start, the route's link and coordinates, the contributions.
    const log = delivered(test);
    // Each participant's Note links their own route file.
    // Bound to the recipient, not to the order of the log, and whatever Notes or Updates came.
    const tokensOf = (recipient: string) => [
      ...new Set(
        log
          .filter((sent) => addresses(sent.activity.to).includes(recipient))
          .flatMap((sent) =>
            [
              ...JSON.stringify(sent.activity).matchAll(
                /\/federation\/notes\/([^/"\\]+)\/route\.gpx/g,
              ),
            ].map((match) => match[1] ?? ""),
          ),
      ),
    ];
    const [tokenA = "", ...extraA] = tokensOf(a.id);
    const [tokenA2 = "", ...extraA2] = tokensOf(a2.id);
    expect({ extraA, extraA2 }).toEqual({ extraA: [], extraA2: [] });
    expect(tokenA).not.toBe("");
    expect(tokenA2).not.toBe("");
    expect(tokenA).not.toBe(tokenA2);
    const tokens = [tokenA, tokenA2];
    const secrets = [
      START,
      LAT,
      LNG,
      // A rounded copy of the exact start would still tell where it is.
      "48.2042",
      GPX_LAT,
      GPX_LNG,
      tokenA,
      tokenA2,
      "/federation/notes/",
      HOST_TEXT,
      REPLY_TEXT,
    ];
    const holdsSecret = (activity: Record<string, unknown>) =>
      secrets.some((secret) => JSON.stringify(activity).includes(secret));

    // Whatever carries a secret is a Create or Update of a Note, addressed to exactly one
    // accepted participant, delivered to that participant's server, from the instance actor.
    const accepted = new Map([
      [a.id, "https://accepted.example/inbox"],
      [a2.id, "https://accepted2.example/inbox"],
    ]);
    const carriers = log.filter((sent) => holdsSecret(sent.activity));
    const misaddressed = carriers.filter((sent) => {
      const object = sent.activity.object;
      const isObject = typeof object === "object" && object !== null;
      const note = (isObject ? object : {}) as Record<string, unknown>;
      const [to, ...others] = addresses(sent.activity.to);
      const exactlyOne =
        to !== undefined &&
        others.length === 0 &&
        accepted.has(to) &&
        JSON.stringify(addresses(note.to)) === JSON.stringify([to]) &&
        sent.url === accepted.get(to);
      const closed =
        isObject &&
        ["cc", "bto", "bcc", "audience"].every((key) => !(key in sent.activity) && !(key in note));
      const kind =
        isNoteActivity(sent.activity) &&
        ["Create", "Update"].includes(String(sent.activity.type)) &&
        [INSTANCE, posterActor].includes(String(sent.activity.actor)) &&
        note.type === "Note";
      return !(exactlyOne && closed && kind) || JSON.stringify(sent.activity).includes("Public");
    });
    expect(misaddressed.map((sent) => sent.url)).toEqual([]);

    // Not vacuous: each secret did reach the accepted participants it is meant for.
    const reached = (secret: string) =>
      carriers
        .filter((sent) => JSON.stringify(sent.activity).includes(secret))
        .map((sent) => addresses(sent.activity.to)[0])
        .sort((x, y) => String(x).localeCompare(String(y)));
    const both = [a.id, a2.id].sort((x, y) => x.localeCompare(y));
    // (The route's coordinates are in the file behind the link, not in the Note.)
    for (const secret of [START, LAT, LNG, HOST_TEXT]) {
      expect(reached(secret)).toEqual(both);
    }
    expect(reached(tokenA)).toEqual([a.id]);
    expect(reached(tokenA2)).toEqual([a2.id]);
    // A's own reply goes to the other participant only, never back to its author.
    expect(reached(REPLY_TEXT)).toEqual([a2.id]);

    // Nothing reached the follower, the pending or rejected person, or any other server.
    const others = log.filter((sent) => !carriers.includes(sent));
    expect(others.filter((sent) => holdsSecret(sent.activity))).toEqual([]);
    const strangers = log.filter((sent) => /(pending|rejected|follower)\.example/.test(sent.url));
    expect(strangers.map((sent) => sent.activity.type)).toContain("Create");
    expect(strangers.filter((sent) => isNoteActivity(sent.activity))).toEqual([]);
    expect(strangers.filter((sent) => holdsSecret(sent.activity))).toEqual([]);
    // Whatever any of them was sent is no Note.
    for (const stranger of ["pending.example", "rejected.example", "follower.example"]) {
      const toThem = log.filter((sent) => sent.url.includes(stranger));
      expect(toThem.filter((sent) => isNoteActivity(sent.activity))).toEqual([]);
    }
    expect(
      log
        .filter((sent) => sent.activity.type === "Accept")
        .map((sent) => sent.url)
        .sort(),
    ).toEqual(
      expect.arrayContaining([
        "https://accepted.example/inbox",
        "https://accepted2.example/inbox",
        "https://follower.example/inbox",
      ]),
    );
    // No request the app made to fetch anything carries a secret in its address.
    expect(
      test.federationHttp.requests
        .map(String)
        .filter((url) => secrets.some((secret) => url.includes(secret))),
    ).toEqual([]);

    // Not in the public Event, the actor documents or their collections either.
    const actorPath = new URL(posterActor).pathname;
    const publicPaths = [
      `/p/${planId}`,
      actorPath,
      `${actorPath}/followers`,
      "/actors/instance",
      "/actors/instance/followers",
      "/.well-known/webfinger?resource=acct:anna@" + HOST,
    ];
    for (const path of publicPaths) {
      const body = await (await test.app.request(path, { headers: AP })).text();
      expect({ path, leaked: secrets.filter((secret) => body.includes(secret)) }).toEqual({
        path,
        leaked: [],
      });
    }
    // The public Event was delivered to the follower, naming none of it.
    const eventDelivery = log.filter(
      (sent) => sent.url === "https://follower.example/inbox" && sent.activity.type === "Create",
    );
    expect(eventDelivery).toHaveLength(1);

    // Deleting the plan: a Delete for every Note that was sent, to the same recipient, from the
    // same actor, and for the Event to the follower.
    const notes = log.filter(
      (sent) => sent.activity.type === "Create" && isNoteActivity(sent.activity),
    );
    expect(notes).toHaveLength(5);
    for (const link of tokens) {
      expect((await test.app.request(`/federation/notes/${link}/route.gpx`)).status).toBe(200);
    }
    const before = delivered(test).length;
    const page = await (await anna.get(`/p/${planId}/host`)).text();
    await anna.postForm(`/p/${planId}/host/delete`, hiddenFields(page));
    await test.runJobs();
    const after = delivered(test).slice(before);
    const deletes = after.filter((sent) => sent.activity.type === "Delete");
    const deletedNotes = deletes.filter((sent) => isNoteActivity(sent.activity));
    const withoutDelete = notes.filter(
      (note) =>
        !deletedNotes.some((gone) => {
          const target = gone.activity.object as { id?: unknown };
          return (
            target.id === (note.activity.object as { id?: unknown }).id &&
            JSON.stringify(addresses(gone.activity.to)) ===
              JSON.stringify(addresses(note.activity.to)) &&
            gone.activity.actor === note.activity.actor &&
            gone.url === note.url
          );
        }),
    );
    expect(withoutDelete.map((note) => note.activity.id)).toEqual([]);
    expect(deletedNotes).toHaveLength(notes.length);
    // The Event is withdrawn from the follower; the Deletes carry none of the secrets.
    expect(
      deletes.filter(
        (sent) =>
          sent.url === "https://follower.example/inbox" &&
          (sent.activity.object as { id?: unknown }).id === planUri(planId),
      ),
    ).toHaveLength(1);
    expect(after.filter((sent) => holdsSecret(sent.activity))).toEqual([]);
    // The pending and rejected people never held a Note, so there is none to withdraw from them.
    const noteRecipients = deletedNotes.flatMap((sent) => addresses(sent.activity.to));
    expect(noteRecipients.filter((to) => [b.id, c.id, f.id].includes(to))).toEqual([]);
    // The route links died with the plan.
    for (const link of tokens) {
      expect((await test.app.request(`/federation/notes/${link}/route.gpx`)).status).toBe(404);
    }
  });

  it("Activities without a valid HTTP signature, or about objects the sending actor does not own, change nothing", async () => {
    const oidc = new FakeOidcServer();
    const test = await createTestApp({
      env: { ...oidc.env(), ADMIN_TOKEN: "admin-token-for-tests-0123456789abcdef" },
      oidc,
    });
    // The host has a fediverse profile, so there is a poster actor with a personal inbox too.
    const host = new TestClient(test.app);
    const started = await host.get("/login/oidc");
    const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), {
      sub: "anna",
      name: "Anna Müller",
    });
    await host.get(`${callback.pathname}${callback.search}`);
    await host.postForm("/account/profile", {
      _csrf: (await host.hiddenFields("/account"))._csrf ?? "",
      handle: "anna",
    });
    const finger = (await (
      await test.app.request(`/.well-known/webfinger?resource=acct:anna@${HOST}`)
    ).json()) as { links: { rel: string; href: string }[] };
    const posterInbox = `${new URL(finger.links.find((l) => l.rel === "self")?.href ?? "").pathname}/inbox`;
    expect(posterInbox).toMatch(/^\/actors\/.+\/inbox$/);
    const { planId } = await createPlanViaUi(host, {});
    const ben = await person(test, "ben", "social.example");
    const cat = await person(test, "cat", "other.example");
    // Mallory shares Ben's server but has keys of her own: only the signature and the ownership
    // checks stand between her and Ben's things.
    const mallory = await remotePerson(test, "mallory", "social.example");
    // Another key pair, for a signature that does not belong to the key id it names.
    const wrong: Remote = { id: ben.id, keys: await generateCryptoKeyPair("RSASSA-PKCS1-v1_5") };
    const noteId = `${ben.id}/statuses/1`;
    await post(test, ben, joinOf(ben, planId));
    await post(test, cat, joinOf(cat, planId));
    await post(test, mallory, joinOf(mallory, planId));
    await post(test, ben, followOf(ben, INSTANCE));
    test.clock.set(AFTER_START);
    await post(test, ben, replyOf(ben, planId, "<p>Ben's own reply</p>"));
    await test.runJobs();
    test.federationHttp.posts.length = 0;
    const queued = () =>
      test.database.sqlite.prepare("select count(*) from job_queue").pluck().get() as number;
    expect(queued()).toBe(0);
    const contributions = () =>
      test.database.sqlite.prepare("select count(*) from recap_contributions").pluck().get();
    expect(contributions()).toBe(1);

    // What each batch sends, in Ben's name or about his things.
    const asBen = [
      {
        id: `${ben.id}#undo-join`,
        type: "Undo",
        object: { ...joinOf(ben, planId), actor: ben.id },
      },
      {
        id: `${ben.id}#undo-follow`,
        type: "Undo",
        object: { ...followOf(ben, INSTANCE), actor: ben.id },
      },
      { id: `${ben.id}#delete`, type: "Delete", object: ben.id },
      {
        id: `${noteId}/delete`,
        type: "Delete",
        to: [INSTANCE],
        object: { id: noteId, type: "Tombstone" },
      },
      {
        id: `${noteId}/update`,
        type: "Update",
        to: [INSTANCE],
        object: {
          id: noteId,
          type: "Note",
          attributedTo: ben.id,
          inReplyTo: planUri(planId),
          to: [INSTANCE],
          content: "<p>Rewritten</p>",
        },
      },
      joinOf(ben, planId, 9),
      followOf(ben, INSTANCE, 9),
      {
        id: `${ben.id}#flag`,
        type: "Flag",
        to: [INSTANCE],
        object: [planUri(planId)],
        content: "Reported by an impostor",
      },
      replyOf(ben, planId, "<p>Said by an impostor</p>", 9),
    ];
    // The same things, signed correctly by Mallory, who acts on Ben's objects as herself.
    const byMallory = [
      asBen[0],
      asBen[1],
      asBen[2],
      asBen[3],
      asBen[4],
      // Her own Update of Ben's Note id, attributed to herself: it passes the attribution check of
      // the inbox and is stopped by the app, which finds the contribution is not hers.
      {
        id: `${noteId}/mallory-update`,
        type: "Update",
        to: [INSTANCE],
        object: {
          id: noteId,
          type: "Note",
          attributedTo: mallory.id,
          inReplyTo: planUri(planId),
          to: [INSTANCE],
          content: "<p>Rewritten by Mallory</p>",
        },
      },
      {
        ...replyOf(mallory, planId, "<p>Under ben's name</p>", 7),
        object: { ...replyOf(mallory, planId, "x", 7).object, attributedTo: ben.id },
      },
    ];

    const send = async (
      path: string,
      activity: Record<string, unknown>,
      how: "unsigned" | "wrong key" | "other actor's key" | "tampered" | "impostor" | "valid",
      sender: Remote = ben,
    ) => {
      const actor = how === "impostor" ? mallory : sender;
      const json = JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        actor: actor.id,
        ...activity,
      });
      const signer = how === "wrong key" ? wrong : how === "other actor's key" ? mallory : actor;
      const request = new Request(`https://${HOST}${path}`, {
        method: "POST",
        headers: { "content-type": "application/activity+json" },
        body: json,
      });
      const signed =
        how === "unsigned"
          ? request
          : await signRequest(request, signer.keys.privateKey, new URL(`${signer.id}#main-key`));
      // A signed body altered on its way: the digest no longer matches.
      const body = how === "tampered" ? json.replace(/"type"/, '"type" ') + " " : json;
      const sent = await test.app.request(path, {
        method: "POST",
        headers: how === "unsigned" ? request.headers : signed.headers,
        body,
      });
      return sent.status;
    };

    const batches = [
      { how: "unsigned", activities: asBen },
      { how: "wrong key", activities: asBen },
      { how: "other actor's key", activities: asBen },
      { how: "tampered", activities: asBen },
      { how: "impostor", activities: byMallory },
    ] as const;
    for (const path of ["/inbox", "/actors/instance/inbox", posterInbox]) {
      // The inboxes count posts per client (120 at a time): let the count refill between paths.
      test.clock.advance({ minutes: 5 });
      for (const { how, activities } of batches) {
        const before = snapshot(test.database, CACHE);
        const statuses: number[] = [];
        for (const activity of activities) statuses.push(await send(path, activity ?? {}, how));
        await test.runJobs();
        // Unsigned, mis-signed and altered requests are refused outright on both inboxes; the
        // impostor's are validly signed, so both inboxes take them (not 401) and the app ignores
        // them.
        const refused = statuses.filter((status) => status === 401).length;
        const taken = statuses.filter((status) => status >= 200 && status < 300).length;
        const n = activities.length;
        expect({ how, refused, taken }).toEqual({
          how,
          refused: how === "impostor" ? 0 : n,
          taken: how === "impostor" ? n : 0,
        });
        expect(statuses.every((status) => status < 500)).toBe(true);
        expect({ path, how, changed: snapshot(test.database, CACHE) !== before }).toEqual({
          path,
          how,
          changed: false,
        });
        expect(queued()).toBe(0);
        expect(test.federationHttp.posts).toEqual([]);
        expect(contributions()).toBe(1);
      }
    }

    // The only thing the refused requests left is Fedify's cache of keys and seen activity ids.
    const cached = test.database.sqlite
      .prepare("select key from fedify_kv")
      .pluck()
      .all() as string[];
    expect(
      cached.filter((key) => !/^\["_fedify","(publicKey|activityIdempotence)"/.test(key)),
    ).toEqual([]);

    // A valid activity afterwards does change something, so the test cannot pass vacuously.
    const before = snapshot(test.database, CACHE);
    const eve = await person(test, "eve", "third.example");
    expect((await post(test, eve, followOf(eve, INSTANCE))).status).toBe(202);
    expect(snapshot(test.database, CACHE)).not.toBe(before);
    expect(queued()).toBeGreaterThan(0);
    await test.runJobs();
    expect(delivered(test).map((sent) => sent.activity.type)).toEqual(["Accept"]);

    // The same through the actor inbox: a valid new Follow is taken, changes state, gets an Accept.
    const beforeActor = snapshot(test.database, CACHE);
    const finn = await person(test, "finn", "fourth.example");
    expect(await send("/actors/instance/inbox", followOf(finn, INSTANCE), "valid", finn)).toBe(202);
    expect(snapshot(test.database, CACHE)).not.toBe(beforeActor);
    expect(queued()).toBeGreaterThan(0);
    test.federationHttp.posts.length = 0;
    await test.runJobs();
    expect(delivered(test).map((sent) => sent.activity.type)).toEqual(["Accept"]);
  });
});
