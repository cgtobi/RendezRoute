// Fediverse direct messages for an account's notices, through the pages and the job runner (spec 7
// Optional notification channels; decisions D44, D45, D47): the switch on the account page for an
// account with a fediverse login, the first message, the expiry warning, and what is and is not
// stored.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { noteHtml } from "../../../src/adapters/out/federation/event.ts";
import { warnExpiringAccounts } from "../../../src/application/account-data.ts";
import { FakeMastodonServer } from "../../fakes/mastodon-server.ts";
import { FakeOidcServer } from "../../fakes/oidc-server.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi } from "../../support/plans.ts";
import {
  delivered,
  type FediverseAccountOptions,
  rows,
  serveFediverseAccount,
  type TestApp,
} from "../../support/remote-people.ts";

const en = translator("en");
const de = translator("de");
const fr = translator("fr");
const HOST = "runs.example.org";
const ACTOR = "https://social.example/users/anna";
const OWN_INBOX = `${ACTOR}/inbox`;
const SHARED_INBOX = "https://social.example/inbox";
const DAY_MS = 24 * 60 * 60 * 1000;

async function setup(env: Record<string, string> = {}) {
  const mastodon = new FakeMastodonServer();
  const oidc = new FakeOidcServer();
  const test = await createTestApp({
    env: { ...oidc.env(), FEDIVERSE_LOGIN: "true", ...env },
    oidc,
    mastodon: [mastodon],
  });
  return { ...test, mastodon, oidc };
}
type World = Awaited<ReturnType<typeof setup>>;

/** Logs a new browser in with a fediverse account at the fake Mastodon server. */
async function fediverseLogin(world: World, username = "anna") {
  const client = new TestClient(world.app);
  const page = await (await client.get("/account")).text();
  const form = page.slice(page.indexOf('action="/login/fediverse"'));
  const started = await client.postForm("/login/fediverse", {
    ...hiddenFields(form),
    server: "social.example",
  });
  const html = (await started.text()).replaceAll("&amp;", "&");
  const authorize = new URL(/<a class="button" href="([^"]+)"/.exec(html)?.[1] ?? "");
  const callback = world.mastodon.approve(authorize, {
    id: `SENTINEL-${username}`,
    username,
    display_name: "Anna",
  });
  await client.get(`${callback.pathname}${callback.search}`);
  return client;
}

async function oidcLogin(world: World) {
  const client = new TestClient(world.app);
  const started = await client.get("/login/oidc");
  const callback = world.oidc.approve(new URL(started.headers.get("location") ?? ""), {
    sub: "bob",
    name: "Bob",
  });
  await client.get(`${callback.pathname}${callback.search}`);
  return client;
}

/** Posts one of the switch's forms with the page's token, in a language. */
async function post(client: TestClient, action: string, language = "en", ip?: string) {
  const hidden = await client.hiddenFields("/account");
  return client.request(action, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "accept-language": language,
      ...(ip === undefined ? {} : { "x-forwarded-for": ip }),
    },
    body: new URLSearchParams({ _csrf: hidden._csrf ?? "" }).toString(),
  });
}
const switchOn = (client: TestClient, language = "en", ip?: string) =>
  post(client, "/account/fediverse-messages", language, ip);
const switchOff = (client: TestClient) => post(client, "/account/fediverse-messages/off");

const count = (test: TestApp, table: string, where = "1 = 1") =>
  test.database.sqlite
    .prepare(`select count(*) from ${table} where ${where}`)
    .pluck()
    .get() as number;
const identityId = (test: TestApp) =>
  test.database.sqlite.prepare("select id from identities").pluck().get() as string;
const channelCount = (test: TestApp) => count(test, "notification_channels");
/** A JSON-LD value that may be one or a list, as a list. */
const asList = (value: unknown): string[] =>
  [value].flat().filter((x) => x !== undefined) as string[];

/** Jobs queued while others run wait for the next run: the lookup first, then the delivery. */
async function runAll(world: World) {
  await world.runJobs();
  await world.runJobs();
}

/** The text of an account message, as the German catalog writes it for this instance. */
const firstMessage = (t: typeof de, instance: string) =>
  [
    t("fediverseDm.first", { instance }),
    t("fediverseDm.keeps"),
    t("fediverseDm.turnOff", { link: `https://${HOST}/account` }),
  ].join("\n\n");

describe("the switch on the account page", () => {
  it("is shown to an account with a fediverse login while federation is on", async () => {
    const world = await setup();
    const anna = await fediverseLogin(world);
    const page = await (await anna.get("/account")).text();
    expect(page).toContain('action="/account/fediverse-messages"');
    expect(page).toContain(escaped(en("fediverseDm.label")));
    expect(page).toContain(
      escaped(en("fediverseDm.hint", { instance: world.config.instanceName })),
    );
    // Closed while off, like the other channels' fold.
    expect(page).toContain('<details class="more-channels">');
  });

  it("is not shown to an account that logged in another way", async () => {
    const world = await setup();
    const bob = await oidcLogin(world);
    const page = await (await bob.get("/account")).text();
    expect(page).not.toContain("/account/fediverse-messages");
    expect(page).not.toContain(escaped(en("fediverseDm.label")));
  });

  it("is not shown while federation is off", async () => {
    const world = await setup({ FEDERATION_ENABLED: "false" });
    const anna = await fediverseLogin(world);
    const page = await (await anna.get("/account")).text();
    expect(page).not.toContain("/account/fediverse-messages");
    expect(page).not.toContain(escaped(en("fediverseDm.label")));
  });
});

describe("switching it on", () => {
  it("stores a confirmed channel with nothing about the recipient and queues the first message", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    const on = await switchOn(anna, "de");
    expect(on.status).toBe(303);
    expect(on.headers.get("location")).toBe("/account#fediverse-messages");
    expect(await world.channels.listFor({ identityId: identityId(world) })).toEqual([
      {
        id: expect.any(String),
        kind: "fediverse_dm",
        owner: { identityId: identityId(world) },
        verified: true,
        language: "de",
      },
    ]);
    expect(
      world.database.sqlite.prepare("select kind, verified from notification_channels").all(),
    ).toEqual([{ kind: "fediverse_dm", verified: 1 }]);
    expect(world.database.sqlite.prepare("select type from job_queue").pluck().all()).toEqual([
      "channelConfirmation",
    ]);
    const page = await (await anna.get("/account")).text();
    expect(page).toContain(escaped(en("fediverseDm.on", { instance: world.config.instanceName })));
    expect(page).toContain('action="/account/fediverse-messages/off"');
    expect(page).toContain('<details class="more-channels" open="">');
  });

  const unresolvable: [string, FediverseAccountOptions | undefined][] = [
    ["WebFinger says not found", { fingerStatus: 404 }],
    ["the server does not answer at all", undefined],
    ["the actor is on another host", { href: "https://evil.example/users/anna" }],
    ["the inbox is on another host", { inbox: "https://evil.example/inbox" }],
    ["the actor has another name", { preferredUsername: "mallory" }],
    ["the actor is not served over https", { href: "http://social.example/users/anna" }],
    ["the inbox is not served over https", { inbox: "http://social.example/users/anna/inbox" }],
    ["WebFinger is not JSON", { fingerBody: "<html></html>" }],
  ];
  it.each(unresolvable)("stores nothing and says so when %s", async (_, options) => {
    const world = await setup();
    if (options !== undefined) serveFediverseAccount(world, "anna", "social.example", options);
    const anna = await fediverseLogin(world);
    const on = await switchOn(anna);
    expect(on.status).toBe(422);
    expect(await on.text()).toContain(escaped(en("fediverseDm.notFound")));
    expect(channelCount(world)).toBe(0);
    expect(count(world, "job_queue")).toBe(0);
    const page = await (await anna.get("/account")).text();
    expect(page).toContain('action="/account/fediverse-messages"');
    expect(page).not.toContain(escaped(en("fediverseDm.notFound")));
  });

  it("looks up the account's own login, whatever the request says", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    serveFediverseAccount(world, "mallory", "evil.example");
    const anna = await fediverseLogin(world);
    const hidden = await anna.hiddenFields("/account");
    await anna.postForm("/account/fediverse-messages", {
      ...hidden,
      handle: "@mallory@evil.example",
      inbox: "https://evil.example/inbox",
      identityId: "someone-else",
    });
    await runAll(world);
    expect(world.federationHttp.requests.map((url) => url.host)).not.toContain("evil.example");
    expect(delivered(world).map((sent) => sent.url)).toEqual([OWN_INBOX]);
  });

  it("changes and looks up nothing when it is already on", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    const requests = world.federationHttp.requests.length;
    for (let n = 0; n < 8; n++) expect((await switchOn(anna)).status).toBe(303);
    expect(world.federationHttp.requests).toHaveLength(requests);
    expect(channelCount(world)).toBe(1);
    expect(count(world, "job_queue")).toBe(1);
  });

  it("does nothing for an account without a fediverse login, or without federation", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const bob = await oidcLogin(world);
    const response = await switchOn(bob);
    expect(response.status).toBe(303);
    expect(channelCount(world)).toBe(0);
    expect(world.federationHttp.requests).toEqual([]);
    const off = await setup({ FEDERATION_ENABLED: "false" });
    const anna = await fediverseLogin(off);
    await switchOn(anna);
    expect(channelCount(off)).toBe(0);
  });

  it("does nothing for a browser that is not logged in", async () => {
    const world = await setup();
    const stranger = new TestClient(world.app);
    const hidden = await stranger.hiddenFields("/account");
    const response = await stranger.postForm("/account/fediverse-messages", hidden);
    expect(response.status).toBe(303);
    expect(channelCount(world)).toBe(0);
    expect(world.federationHttp.requests).toEqual([]);
  });

  it("needs the page's token, as the other forms do", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    const results: number[] = [];
    for (const action of ["/account/fediverse-messages", "/account/fediverse-messages/off"]) {
      results.push((await anna.postForm(action, {})).status);
      results.push((await anna.postForm(action, { _csrf: "forged" })).status);
    }
    expect(results).toEqual([403, 403, 403, 403]);
    expect(channelCount(world)).toBe(0);
    expect(world.federationHttp.requests).toEqual([]);
  });

  it("is limited per account, whatever client it comes from, counting the lookups that were made", async () => {
    const world = await setup({ TRUST_PROXY: "true" });
    serveFediverseAccount(world, "anna", "social.example", { fingerStatus: 404 });
    serveFediverseAccount(world, "bea", "social.example", { fingerStatus: 404 });
    const anna = await fediverseLogin(world);
    const statuses: number[] = [];
    for (let n = 1; n <= 5; n++)
      statuses.push((await switchOn(anna, "en", `203.0.113.${n}`)).status);
    expect(statuses).toEqual([422, 422, 422, 429, 429]);
    expect(world.federationHttp.requests).toHaveLength(3);
    // Another account, even from an address that was refused, is not affected.
    const bea = await fediverseLogin(world, "bea");
    expect((await switchOn(bea, "en", "203.0.113.4")).status).toBe(422);
    // Tokens come back with time: one every ten minutes.
    world.clock.set(new Date(world.clock.now().getTime() + 11 * 60 * 1000).toISOString());
    expect((await switchOn(anna, "en", "203.0.113.9")).status).toBe(422);
    expect((await switchOn(anna, "en", "203.0.113.9")).status).toBe(429);
  });

  it("is limited per client across accounts, counting the lookups that were made", async () => {
    const world = await setup({ TRUST_PROXY: "true" });
    const statuses: number[] = [];
    for (const name of ["a1", "a2", "a3", "a4", "a5", "a6"]) {
      serveFediverseAccount(world, name, "social.example", { fingerStatus: 404 });
      const client = await fediverseLogin(world, name);
      statuses.push((await switchOn(client, "en", "198.51.100.7")).status);
    }
    expect(statuses).toEqual([422, 422, 422, 422, 422, 429]);
  });

  it("does not count a switch-on that looked nothing up against either limit", async () => {
    const world = await setup({ TRUST_PROXY: "true" });
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna, "en", "203.0.113.1");
    const statuses: number[] = [];
    for (let n = 0; n < 8; n++) statuses.push((await switchOn(anna, "en", "203.0.113.1")).status);
    expect(statuses).toEqual(Array<number>(8).fill(303));
  });
});

describe("switching it off", () => {
  it("removes the channel and sends no message, not even the one still waiting", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    const off = await switchOff(anna);
    expect(off.status).toBe(303);
    expect(off.headers.get("location")).toBe("/account#fediverse-messages");
    expect(channelCount(world)).toBe(0);
    await world.runJobs();
    expect(delivered(world)).toEqual([]);
    expect(count(world, "job_queue")).toBe(0);
    expect(await (await anna.get("/account")).text()).toContain(
      'action="/account/fediverse-messages"',
    );
  });
});

describe("switching off while a message is waiting (decision D47)", () => {
  it("drops the waiting message instead of sending it", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    world.federationHttp.respond(OWN_INBOX, { status: 503 });
    await runAll(world);
    expect(world.federationHttp.posts).toHaveLength(1);
    await switchOff(anna);
    world.federationHttp.respond(OWN_INBOX, { status: 202 });
    world.clock.set(new Date(world.clock.now().getTime() + 2 * 60 * 1000).toISOString());
    await runAll(world);
    expect(world.federationHttp.posts).toHaveLength(1);
    expect(count(world, "job_queue")).toBe(0);
  });

  it("sends only the new first message when it is switched on again, not the old one besides", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    world.federationHttp.respond(OWN_INBOX, { status: 503 });
    await runAll(world);
    await switchOff(anna);
    await switchOn(anna);
    world.federationHttp.respond(OWN_INBOX, { status: 202 });
    world.clock.set(new Date(world.clock.now().getTime() + 2 * 60 * 1000).toISOString());
    await runAll(world);
    await runAll(world);
    // The failed first try, and the new message once; the old one's retry was not sent.
    expect(world.federationHttp.posts).toHaveLength(2);
    expect(count(world, "job_queue")).toBe(0);
  });
});

describe("the switch while federation is off", () => {
  it("is offered only to turn off a channel that is on", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    const notify = world.planDeps.notify;
    if (notify === undefined) throw new Error("notify");
    notify.fediverseMessages = undefined;
    const page = await (await anna.get("/account")).text();
    expect(page).toContain(escaped(en("fediverseDm.paused")));
    expect(page).toContain('action="/account/fediverse-messages/off"');
    expect(page).not.toContain('action="/account/fediverse-messages"');
    expect((await switchOff(anna)).status).toBe(303);
    expect(channelCount(world)).toBe(0);
    expect(await (await anna.get("/account")).text()).not.toContain("/account/fediverse-messages");
  });
});

describe("the first message", () => {
  it("goes once, from the instance actor, to the account's own inbox and nobody else", async () => {
    const world = await setup();
    const account = serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna, "de");
    await world.runJobs();
    await world.runJobs();
    const sent = delivered(world);
    expect(sent).toHaveLength(1);
    const [only] = sent;
    // The person's own inbox, never the server's shared one.
    expect(only?.url).toBe(OWN_INBOX);
    expect(world.federationHttp.posts.map((post) => post.url.href)).not.toContain(SHARED_INBOX);
    const activity = only?.activity ?? {};
    const note = activity.object as Record<string, unknown>;
    expect(activity.type).toBe("Create");
    expect(note.type).toBe("Note");
    expect(activity.actor).toBe(`https://${HOST}/actors/instance`);
    expect(note.attributedTo).toBe(`https://${HOST}/actors/instance`);
    // Addressed to that actor and no one: no Public, no followers, nothing in cc, bto or bcc.
    expect(asList(activity.to)).toEqual([account.actorId]);
    expect(asList(note.to)).toEqual([account.actorId]);
    for (const part of [activity, note]) {
      for (const field of ["cc", "bto", "bcc", "audience"]) expect(part[field]).toBeUndefined();
    }
    expect(JSON.stringify(activity)).not.toMatch(/Public|followers/);
    // The mention is what makes Mastodon show it as a direct message.
    expect([note.tag].flat()).toEqual([
      expect.objectContaining({
        type: "Mention",
        href: account.actorId,
        name: "@anna@social.example",
      }),
    ]);
    expect(note.content).toBe(noteHtml(firstMessage(de, world.config.instanceName)));
    expect(new Date(String(note.published)).getTime()).toBe(world.clock.now().getTime());
    expect(String(note.id)).toMatch(/^https:\/\/runs\.example\.org\/notes\/[0-9a-f-]{36}$/);
    // Signed by the instance actor.
    expect(only?.headers.signature).toContain(`keyId="https://${HOST}/actors/instance#main-key"`);
    // No plan, no date, no link to a plan.
    expect(String(note.content)).not.toMatch(/\/p\/|\d{4}/);
    expect(String(note.content)).toContain(`https://${HOST}/account`);
  });

  it("is written in the language the switch was used in", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna, "fr");
    await runAll(world);
    const note = delivered(world)[0]?.activity.object as { content: string };
    expect(note.content).toBe(noteHtml(firstMessage(fr, world.config.instanceName)));
  });

  it("is tried again after a temporary failure, on the job schedule", async () => {
    const world = await setup();
    const account = serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    serveFediverseAccount(world, "anna", "social.example", { fingerStatus: 503 });
    await world.runJobs();
    expect(delivered(world)).toEqual([]);
    expect(count(world, "job_queue")).toBe(1);
    serveFediverseAccount(world, "anna");
    await world.runJobs();
    expect(delivered(world)).toEqual([]);
    world.clock.set(new Date(world.clock.now().getTime() + 61_000).toISOString());
    await runAll(world);
    expect(delivered(world).map((sent) => sent.url)).toEqual([account.inbox]);
    expect(count(world, "job_queue")).toBe(0);
  });

  it("is dropped after a final answer, and the channel stays to be switched off", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    serveFediverseAccount(world, "anna", "social.example", { fingerStatus: 404 });
    await world.runJobs();
    expect(delivered(world)).toEqual([]);
    expect(count(world, "job_queue")).toBe(0);
    expect(channelCount(world)).toBe(1);
  });
});

describe("the expiry warning", () => {
  async function warn(world: World) {
    return warnExpiringAccounts({ ...world.planDeps, identities: world.identities });
  }

  it("comes as a direct message with the date and the instance's name, once, and nothing of any plan", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await createPlanViaUi(anna, { title: "Secret Hill Repeats 9931" });
    await switchOn(anna, "fr");
    await runAll(world);
    const lastActive = world.clock.now();
    world.clock.set(new Date(lastActive.getTime() + 352 * DAY_MS).toISOString());
    expect(await warn(world)).toBe(1);
    expect(await warn(world)).toBe(0);
    await runAll(world);
    const sent = delivered(world);
    expect(sent.map((one) => one.url)).toEqual([OWN_INBOX, OWN_INBOX]);
    const date = new Intl.DateTimeFormat("fr", {
      timeZone: world.config.defaultTimezone,
      dateStyle: "long",
    }).format(new Date(lastActive.getTime() + 365 * DAY_MS));
    const note = sent[1]?.activity.object as { content: string; id: string };
    expect(note.content).toBe(
      noteHtml(
        [
          fr("notice.expirySubject", { instance: world.config.instanceName, date }),
          fr("notice.expiryBody", { date }),
          fr("fediverseDm.turnOff", { link: `https://${HOST}/account` }),
        ].join("\n\n"),
      ),
    );
    expect(note.content).not.toMatch(/Secret|Hill|Flaucher|\/p\//);
    // Each message has an address of its own.
    const first = sent[0]?.activity.object as { id: string } | undefined;
    expect(note.id).not.toBe(first?.id);
  });

  it("is not queued while federation is off", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    world.clock.set(new Date(world.clock.now().getTime() + 352 * DAY_MS).toISOString());
    const notify = world.planDeps.notify;
    const without = {
      ...world.planDeps,
      notify: notify && { ...notify, fediverseMessages: undefined },
    };
    expect(await warnExpiringAccounts({ ...without, identities: world.identities })).toBe(0);
  });
});

describe("what is stored", () => {
  it("holds nothing about the recipient: not the actor, address, inbox or host, nor the text", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna, "de");
    const secrets = [
      "users/anna",
      "anna@social.example",
      "social.example/inbox",
      de("fediverseDm.keeps"),
    ];
    const scan = (when: string) => {
      const file = Buffer.from(world.database.sqlite.serialize());
      for (const secret of secrets) {
        expect([when, secret, file.includes(secret)]).toEqual([when, secret, false]);
      }
      for (const table of ["notification_channels", "job_queue", "fedify_kv", "identities"]) {
        for (const secret of secrets) expect(rows(world, table)).not.toContain(secret);
      }
    };
    scan("after switching on");
    // A message waiting to be delivered carries the inbox and text, encrypted.
    world.federationHttp.respond(OWN_INBOX, { status: 503 });
    await runAll(world);
    expect(count(world, "job_queue", "type = 'federationDelivery'")).toBe(1);
    scan("while waiting");
    world.federationHttp.respond(OWN_INBOX, { status: 202 });
    world.clock.set(new Date(world.clock.now().getTime() + 10 * 60 * 1000).toISOString());
    await world.runJobs();
    scan("after sending");
    expect(delivered(world).length).toBeGreaterThan(0);
    expect(world.logs.join("\n")).not.toMatch(/users\/anna|anna@social|social\.example/);
    // Fedify keeps public keys of servers that post to us, and nothing of an account's address.
    const kv = world.database.sqlite.prepare("select key from fedify_kv").pluck().all() as string[];
    expect(kv.filter((key) => key.includes("anna"))).toEqual([]);
  });

  it("is left out of the account's export, which keeps its shape", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    const files = unzipSync(
      new Uint8Array(await (await anna.get("/account/export.zip")).arrayBuffer()),
    );
    const data = JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array())) as {
      version: number;
      account: Record<string, unknown>;
    };
    expect(data.version).toBe(7);
    expect(Object.keys(data.account)).toEqual([
      "provider",
      "subject",
      "handle",
      "displayName",
      "createdAt",
      "lastActiveAt",
      "notificationEmail",
      "telegramChat",
      "fediverseHandle",
    ]);
  });

  it("leaves nothing behind when the account is deleted, not even a message not yet delivered", async () => {
    const world = await setup();
    serveFediverseAccount(world, "anna");
    const anna = await fediverseLogin(world);
    await switchOn(anna);
    world.federationHttp.respond(OWN_INBOX, { status: 503 });
    await runAll(world);
    expect(count(world, "job_queue", "type = 'federationDelivery'")).toBe(1);
    const hidden = await anna.hiddenFields("/account/delete");
    const deleted = await anna.postForm("/account/delete", hidden);
    expect(deleted.headers.get("location")).toBe("/account?accountDeleted");
    expect(channelCount(world)).toBe(0);
    expect(count(world, "job_queue")).toBe(0);
    expect(count(world, "identities")).toBe(0);
    const file = Buffer.from(world.database.sqlite.serialize());
    expect(file.includes("users/anna")).toBe(false);
  });
});

describe("the privacy notice", () => {
  it("has a line on fediverse messages while federation is on, and only then", async () => {
    const line = en("privacy.federationMessages");
    const text = async (env: Record<string, string>) =>
      (await (await new TestClient((await createTestApp({ env })).app).get("/privacy")).text())
        .replaceAll("&#39;", "'")
        .replaceAll("&quot;", '"');
    expect(await text({})).toContain(line);
    expect(await text({ FEDERATION_ENABLED: "false" })).not.toContain(line);
  });
});
