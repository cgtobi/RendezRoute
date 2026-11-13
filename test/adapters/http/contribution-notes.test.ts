// Recap contributions over federation through the inboxes and the job queue (spec 6 recap, 7
// ActivityPub, 3.6, 3.11; decisions D44, D45; 0.9 step 12a): a contribution goes as a signed direct
// Note to each joined remote participant but its author; a private reply from a joined remote
// participant becomes a contribution; anything public, foreign, unsigned or from anyone else
// changes nothing; Updates and Deletes follow the web's lifecycle, also after the plan is gone.
import { generateCryptoKeyPair } from "@fedify/fedify";
import { describe, expect, it, vi } from "vite-plus/test";
import { joinRemote } from "../../../src/application/remote-participants.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";
import {
  delivered,
  HOST,
  INSTANCE,
  isNoteActivity,
  joinOf,
  post,
  remotePerson,
  rows,
  type Remote,
  type TestApp,
  tentativeOf,
} from "../../support/remote-people.ts";

// Making RSA keys for the impostor is slow when the whole suite runs at once.
vi.setConfig({ testTimeout: 30_000 });

const AFTER_START = "2026-06-07T06:00:00Z";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const planUri = (planId: string) => `https://${HOST}/p/${planId}`;

/**
 * Generating RSA keys is slow: the well-behaved remote people of this file share one pair, while an
 * impostor (`mallory`) gets a pair of their own, so a signature still tells them apart.
 */
let sharedKeys: Promise<Remote["keys"]> | undefined;
const person = async (test: TestApp, name: string, server = "social.example") =>
  remotePerson(
    test,
    name,
    server,
    await (sharedKeys ??= generateCryptoKeyPair("RSASSA-PKCS1-v1_5")),
  );

/** A plan hosted by a fresh browser, with Ben and Cat (remote, joined) and Ida (remote, interested). */
async function setup(
  beforeStart: (test: TestApp, planId: string) => Promise<void> = () => Promise.resolve(),
) {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host, {});
  const ben = await person(test, "ben");
  const cat = await person(test, "cat", "other.example");
  const ida = await person(test, "ida", "third.example");
  await post(test, ben, joinOf(ben, planId));
  await post(test, cat, joinOf(cat, planId));
  await post(test, ida, tentativeOf(ida, planId));
  await beforeStart(test, planId);
  await test.runJobs();
  test.federationHttp.posts.length = 0;
  test.clock.set(AFTER_START);
  return { test, host, planId, ben, cat, ida };
}

/** The same plan with Mallory, who has joined too, on Ben's server but with keys of their own. */
async function setupWithMallory() {
  let mallory: Remote | undefined;
  const base = await setup(async (test, planId) => {
    mallory = await remotePerson(test, "mallory");
    await post(test, mallory, joinOf(mallory, planId));
  });
  if (mallory === undefined) throw new Error("mallory did not join");
  return { ...base, mallory };
}

const csrfOf = async (client: TestClient, planId: string) =>
  hiddenFields(await (await client.get(`/p/${planId}`)).text())._csrf ?? "";

async function contribute(client: TestClient, planId: string, body: string, linkUrl = "") {
  return client.postForm(`/p/${planId}/recap`, {
    _csrf: await csrfOf(client, planId),
    body,
    linkUrl,
  });
}

const contributionIds = (test: TestApp) =>
  (
    test.database.sqlite
      .prepare("select id from recap_contributions order by created_at, id")
      .all() as { id: string }[]
  ).map((row) => row.id);

/** The deliveries about contribution Notes: `Create`, `Update` or `Delete`, with their Note. */
const noteDeliveries = (test: TestApp, type: "Create" | "Update" | "Delete") =>
  delivered(test).filter((sent) => sent.activity.type === type && isNoteActivity(sent.activity));

/** The Notes carrying contributions, not the private Notes with the exact start (decision D43). */
const contributionNoteIds = (test: TestApp) =>
  new Set(
    (
      test.database.sqlite.prepare("select note_id from contribution_notes").all() as {
        note_id: string;
      }[]
    ).map((row) => `https://${HOST}/notes/${row.note_id}`),
  );

/** The deliveries of an activity type whose object is one of the given Notes. */
const aboutNotes = (test: TestApp, type: "Create" | "Update" | "Delete", ids: Set<string>) =>
  noteDeliveries(test, type).filter((sent) =>
    ids.has(String((sent.activity.object as { id?: unknown }).id)),
  );

const noteOf = (sent: { activity: Record<string, unknown> } | undefined) =>
  sent?.activity.object as Record<string, unknown> | undefined;

const section = (html: string) => /<section class="recap"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

/** A reply `Note` from `from`, as a Mastodon-like server posts it to our inbox. */
function reply(
  from: { id: string },
  planId: string,
  {
    n = 1,
    content = "<p>Nice one</p>",
    to = [INSTANCE],
    cc = [],
    bto,
    bcc,
    inReplyTo = planUri(planId),
    attributedTo = from.id,
    noteId = `${from.id}/statuses/${n}`,
    extra = {},
  }: {
    n?: number;
    content?: string;
    to?: string[];
    cc?: string[];
    bto?: string[];
    bcc?: string[];
    inReplyTo?: string;
    attributedTo?: string;
    noteId?: string;
    extra?: Record<string, unknown>;
  } = {},
) {
  return {
    id: `${noteId}/activity-${n}`,
    type: "Create",
    to,
    cc,
    ...(bto === undefined ? {} : { bto }),
    ...(bcc === undefined ? {} : { bcc }),
    object: {
      id: noteId,
      type: "Note",
      attributedTo,
      inReplyTo,
      to,
      cc,
      ...(bto === undefined ? {} : { bto }),
      ...(bcc === undefined ? {} : { bcc }),
      content,
      published: "2026-06-07T07:00:00Z",
      ...extra,
    },
  };
}

const updateOf = (
  from: { id: string },
  planId: string,
  noteId: string,
  content: string,
  n = 1,
) => ({
  id: `${noteId}/update-${n}`,
  type: "Update",
  to: [INSTANCE],
  object: {
    id: noteId,
    type: "Note",
    attributedTo: from.id,
    inReplyTo: planUri(planId),
    to: [INSTANCE],
    content,
    updated: "2026-06-07T08:00:00Z",
  },
});

const deleteOf = (noteId: string, n = 1) => ({
  id: `${noteId}/delete-${n}`,
  type: "Delete",
  to: [INSTANCE],
  object: { id: noteId, type: "Tombstone" },
});

describe("a contribution sent to remote participants", () => {
  it("is a signed Create to each joined participant alone, a reply to the plan's Event, with name, comment, link, plan page and the copies notice", async () => {
    const { test, host, planId } = await setup();
    const wanda = new TestClient(test.app);
    test.clock.set("2026-06-01T08:00:00Z");
    await respondViaUi(wanda, planId, "Wanda", "joined");
    test.clock.set(AFTER_START);
    await contribute(wanda, planId, "Lovely Quokka loop", "https://photos.example/quokka");
    await test.runJobs();
    const creates = noteDeliveries(test, "Create");
    expect(creates.map((sent) => sent.url).sort()).toEqual([
      "https://other.example/inbox",
      "https://social.example/inbox",
    ]);
    expect(
      creates.map((sent) => String(noteOf(sent)?.to)).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["https://other.example/users/cat", "https://social.example/users/ben"]);
    for (const sent of creates) {
      const note = noteOf(sent);
      expect(sent.headers.signature).toContain(`keyId="${INSTANCE}#main-key"`);
      // To that recipient alone: no cc, no other recipient, never public.
      expect(note).toMatchObject({
        type: "Note",
        attributedTo: INSTANCE,
        inReplyTo: planUri(planId),
      });
      expect([sent.activity.to]).toEqual([note?.to]);
      for (const key of ["cc", "bto", "bcc", "audience"]) {
        expect(sent.activity).not.toHaveProperty(key);
        expect(note).not.toHaveProperty(key);
      }
      const content = String(note?.content);
      expect(content).toContain("Wanda wrote in the recap:");
      expect(content).toContain("Lovely Quokka loop");
      expect(content).toContain("Link: https://photos.example/quokka");
      expect(content).toContain(`Plan page: ${planUri(planId)}`);
      expect(content).toContain("Your server may keep copies of this message.");
    }
    // Interested Ida and nobody else got one, and the host sees it on the page as before.
    expect(delivered(test).some((sent) => sent.url.includes("third.example"))).toBe(false);
    expect(section(await (await host.get(`/p/${planId}`)).text())).toContain("Lovely Quokka loop");
  });

  it("is written in the plan's language", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    await host.postForm("/language", {
      ...(await host.hiddenFields("/new")),
      language: "de",
      returnTo: "/new",
    });
    const { planId } = await createPlanViaUi(host, {});
    const ben = await person(test, "ben");
    await post(test, ben, joinOf(ben, planId));
    await test.runJobs();
    test.federationHttp.posts.length = 0;
    test.clock.set(AFTER_START);
    await contribute(host, planId, "Bis bald");
    await test.runJobs();
    const content = String(noteOf(noteDeliveries(test, "Create")[0])?.content);
    expect(content).toContain("Anna hat im Rückblick geschrieben:");
    expect(content).toContain("Dein Server kann Kopien dieser Nachricht behalten.");
  });

  it("holds no exact start, no route and no third-party address but its own link", async () => {
    const { test, host, planId } = await setup();
    await contribute(host, planId, "See you", "https://photos.example/our-link");
    await test.runJobs();
    const [create] = noteDeliveries(test, "Create");
    const content = String(noteOf(create)?.content);
    const addresses = content.match(/https?:\/\/[^\s<]+/g) ?? [];
    expect(addresses.sort()).toEqual(["https://photos.example/our-link", planUri(planId)].sort());
    for (const secret of ["North gate", "48.16321", "11.60147", "gpx"]) {
      expect(JSON.stringify(create?.activity)).not.toContain(secret);
    }
  });

  it("is sent from a Create that carries the plan, so one not yet delivered goes with it", async () => {
    const { test, host, planId } = await setup();
    await contribute(host, planId, "Queued", "");
    const jobs = test.database.sqlite
      .prepare("select type, plan_id, response_id from job_queue where type = 'federationDelivery'")
      .all() as { plan_id: string | null; response_id: string | null }[];
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.plan_id).toBe(planId);
      expect(job.response_id).not.toBeNull();
    }
  });
});

describe("a contribution edited", () => {
  it("is an Update of the same Note, only when its text or link changed", async () => {
    const { test, host, planId } = await setup();
    await contribute(host, planId, "Before", "");
    await test.runJobs();
    const created = noteDeliveries(test, "Create");
    test.federationHttp.posts.length = 0;
    const [id = ""] = contributionIds(test);
    const edit = async (body: string, linkUrl = "") =>
      host.postForm(`/p/${planId}/recap/${id}`, {
        _csrf: await csrfOf(host, planId),
        body,
        linkUrl,
      });
    await edit("Before");
    await test.runJobs();
    expect(delivered(test)).toEqual([]);
    await edit("After edit");
    await test.runJobs();
    const updates = noteDeliveries(test, "Update");
    expect(updates).toHaveLength(2);
    expect(new Set(updates.map((sent) => noteOf(sent)?.id))).toEqual(
      new Set(created.map((sent) => noteOf(sent)?.id)),
    );
    for (const sent of updates) {
      expect(String(noteOf(sent)?.content)).toContain("After edit");
      expect(noteOf(sent)).toHaveProperty("updated");
    }
  });
});

describe("withdrawing contribution Notes", () => {
  it("is a Delete from the sender to each recipient when the author deletes it, and the Create still waiting is dropped", async () => {
    const { test, host, planId } = await setup();
    await contribute(host, planId, "Regret", "");
    const [id = ""] = contributionIds(test);
    // Not yet delivered: the Create waits in the queue while the author deletes the contribution.
    await host.postForm(`/p/${planId}/recap/${id}/delete`, { _csrf: await csrfOf(host, planId) });
    await test.runJobs();
    expect(noteDeliveries(test, "Create")).toEqual([]);
    const deletes = noteDeliveries(test, "Delete");
    expect(deletes.map((sent) => sent.url).sort()).toEqual([
      "https://other.example/inbox",
      "https://social.example/inbox",
    ]);
    for (const sent of deletes) {
      expect(sent.headers.signature).toContain(`keyId="${INSTANCE}#main-key"`);
      expect(sent.activity.object).toMatchObject({ type: "Tombstone" });
      expect(Object.keys(sent.activity)).not.toContain("cc");
    }
    expect(rows(test, "contribution_notes")).toBe("[]");
  });

  it("is a Delete when the host hides it, a new Note when the host shows it again", async () => {
    const { test, host, planId } = await setup();
    await contribute(host, planId, "Spicy", "");
    await test.runJobs();
    const first = noteDeliveries(test, "Create").map((sent) => noteOf(sent)?.id);
    test.federationHttp.posts.length = 0;
    const [id = ""] = contributionIds(test);
    await host.postForm(`/p/${planId}/recap/${id}/hide`, { _csrf: await csrfOf(host, planId) });
    await test.runJobs();
    expect(noteDeliveries(test, "Delete")).toHaveLength(2);
    test.federationHttp.posts.length = 0;
    await host.postForm(`/p/${planId}/recap/${id}/show`, { _csrf: await csrfOf(host, planId) });
    await test.runJobs();
    const again = noteDeliveries(test, "Create");
    expect(again).toHaveLength(2);
    for (const sent of again) expect(first).not.toContain(noteOf(sent)?.id);
  });

  it("is a Delete for every contribution when the host deletes the recap", async () => {
    const { test, host, planId } = await setup();
    await contribute(host, planId, "One", "");
    await contribute(host, planId, "Two", "");
    await test.runJobs();
    test.federationHttp.posts.length = 0;
    const page = await (await host.get(`/p/${planId}/host`)).text();
    await host.postForm(`/p/${planId}/host/recap/delete`, hiddenFields(page));
    await test.runJobs();
    expect(noteDeliveries(test, "Delete")).toHaveLength(4);
  });

  it("is a Delete to the participants when the author leaves, and of what was sent to the leaver", async () => {
    const { test, host, planId, ben } = await setup();
    await contribute(host, planId, "For all", "");
    await post(test, ben, reply(ben, planId, { content: "<p>From ben</p>" }));
    await test.runJobs();
    const ids = contributionNoteIds(test);
    expect(ids.size).toBe(3);
    test.federationHttp.posts.length = 0;
    await post(test, ben, {
      id: `${ben.id}#undo-1`,
      type: "Undo",
      object: { ...joinOf(ben, planId), actor: ben.id },
    });
    await test.runJobs();
    const deletes = aboutNotes(test, "Delete", ids);
    // To ben: the host's contribution; to cat: ben's contribution.
    expect(deletes.map((sent) => sent.url).sort()).toEqual([
      "https://other.example/inbox",
      "https://social.example/inbox",
    ]);
    expect(await contributionBodies(test)).toEqual(["For all"]);
  });

  it("is a Delete for each, from the sender and after the Delete of the plan's other Notes, when the host deletes the plan; the jobs outlive it", async () => {
    const { test, host, planId } = await setup();
    await contribute(host, planId, "Bye", "");
    await test.runJobs();
    const ids = contributionNoteIds(test);
    test.federationHttp.posts.length = 0;
    const page = await (await host.get(`/p/${planId}/host`)).text();
    await host.postForm(`/p/${planId}/host/delete`, hiddenFields(page));
    const queued = test.database.sqlite
      .prepare("select plan_id, response_id from job_queue where type = 'federationDelivery'")
      .all() as { plan_id: string | null; response_id: string | null }[];
    // The Delete jobs carry neither plan nor response, so they are still there.
    expect(queued.length).toBeGreaterThan(0);
    for (const job of queued) expect(job).toEqual({ plan_id: null, response_id: null });
    await test.runJobs();
    const deletes = aboutNotes(test, "Delete", ids);
    expect(deletes.map((sent) => sent.url).sort()).toEqual([
      "https://other.example/inbox",
      "https://social.example/inbox",
    ]);
    for (const sent of deletes) {
      expect(sent.headers.signature).toContain(`keyId="${INSTANCE}#main-key"`);
    }
  });
});

async function contributionBodies(test: TestApp) {
  const ids = contributionIds(test);
  const bodies: string[] = [];
  for (const id of ids) {
    const found = await test.planDeps.recap.findById(id);
    bodies.push(found?.body ?? "");
  }
  return bodies;
}

describe("a reply from a joined remote participant", () => {
  it("becomes a contribution under their name, as plain text with the link split off, shown to the host and the participants", async () => {
    const { test, host, planId, ben } = await setup();
    const wanda = new TestClient(test.app);
    test.clock.set("2026-06-01T08:00:00Z");
    await respondViaUi(wanda, planId, "Wanda", "joined");
    test.clock.set(AFTER_START);
    const content =
      '<p><span class="h-card"><a href="https://runs.example.org/actors/instance" class="u-url mention">@<span>runs</span></a></span> Marvellous <b>route</b> &amp; weather<br>' +
      'photos: <a href="https://photos.example/ben?x=1&amp;y=2">https://photos.example/ben?x=1&amp;y=2</a></p>';
    const response = await post(test, ben, reply(ben, planId, { content }));
    expect(response.status).toBe(202);
    const [id = ""] = contributionIds(test);
    const stored = await test.planDeps.recap.findById(id);
    expect(stored).toMatchObject({
      body: "@runs Marvellous route & weather\nphotos:",
      linkUrl: "https://photos.example/ben?x=1&y=2",
      hiddenByHost: false,
    });
    for (const viewer of [host, wanda]) {
      const html = section(await (await viewer.get(`/p/${planId}`)).text());
      expect(html).toContain("ben@social.example");
      expect(html).toContain("Marvellous route &amp; weather");
      expect(html).toContain('href="https://photos.example/ben?x=1&amp;y=2"');
    }
    // The host can hide it, like any contribution.
    await host.postForm(`/p/${planId}/recap/${id}/hide`, { _csrf: await csrfOf(host, planId) });
    expect(section(await (await wanda.get(`/p/${planId}`)).text())).not.toContain("Marvellous");
  });

  it("takes its link from a Link attachment when the text has none, and ignores every other attachment", async () => {
    const { test, planId, ben } = await setup();
    const attachment = [
      { type: "Document", mediaType: "image/png", url: "https://cdn.example/picture.png" },
      { type: "Link", href: "ftp://not-web.example/x" },
      { type: "Link", href: "https://trails.example/attached-link" },
    ];
    await post(
      test,
      ben,
      reply(ben, planId, { content: "<p>With attachments</p>", extra: { attachment } }),
    );
    const [id = ""] = contributionIds(test);
    expect(await test.planDeps.recap.findById(id)).toMatchObject({
      body: "With attachments",
      linkUrl: "https://trails.example/attached-link",
    });
    expect(rows(test, "recap_contributions")).not.toContain("picture.png");
  });

  it("is fanned out as a Note to the other joined participants, from the instance, with the author's shown name, and never back to the author", async () => {
    const { test, planId, ben } = await setup();
    await post(test, ben, reply(ben, planId, { content: "<p>Ben says hello</p>" }));
    await test.runJobs();
    const creates = noteDeliveries(test, "Create");
    expect(creates.map((sent) => sent.url)).toEqual(["https://other.example/inbox"]);
    const note = noteOf(creates[0]);
    expect(note?.to).toBe("https://other.example/users/cat");
    const content = String(note?.content);
    expect(content).toContain("ben@social.example wrote in the recap:");
    expect(content).toContain("Ben says hello");
    // Not to ben's server, and not to interested Ida.
    expect(delivered(test).some((sent) => /social\.example|third\.example/.test(sent.url))).toBe(
      false,
    );
  });

  it.each([
    ["public", { to: [PUBLIC] }],
    ["Public in its short form", { to: ["as:Public"] }],
    [
      "unlisted: to followers, cc public",
      { to: ["https://social.example/users/ben/followers"], cc: [PUBLIC] },
    ],
    ["followers only", { to: ["https://social.example/users/ben/followers"] }],
    ["private, but cc public", { to: [INSTANCE], cc: [PUBLIC] }],
    [
      "private, but cc its own followers",
      { to: [INSTANCE], cc: ["https://social.example/users/ben/followers"] },
    ],
    [
      "private, but widened to another person",
      { to: [INSTANCE, "https://other.example/users/cat"] },
    ],
    ["bto public", { to: [INSTANCE], bto: [PUBLIC] }],
    ["bcc someone else", { to: [INSTANCE], bcc: ["https://other.example/users/cat"] }],
    ["addressed to nobody", { to: [] }],
    ["addressed to someone else's actor", { to: ["https://social.example/users/zed"] }],
    ["addressed to another actor of this instance", { to: [`https://${HOST}/actors/nobody-here`] }],
  ] as const)("is ignored when %s", async (name, addressing) => {
    const { test, planId, ben } = await setup();
    const marker = `Marker ${name}`;
    const response = await post(
      test,
      ben,
      reply(ben, planId, {
        content: `<p>${marker}</p>`,
        to: [...addressing.to],
        ...("cc" in addressing ? { cc: [...addressing.cc] } : {}),
        ...("bto" in addressing ? { bto: [...addressing.bto] } : {}),
        ...("bcc" in addressing ? { bcc: [...addressing.bcc] } : {}),
      }),
    );
    expect(response.status).toBe(202);
    await test.runJobs();
    expect(contributionIds(test)).toEqual([]);
    expect(rows(test, "remote_contributions")).toBe("[]");
    expect(delivered(test)).toEqual([]);
  });

  it("is ignored from anyone who has not joined, and from someone unknown", async () => {
    const { test, planId, ida } = await setup();
    const unknown = await person(test, "nobody", "unknown.example");
    expect((await post(test, ida, reply(ida, planId))).status).toBe(202);
    expect((await post(test, unknown, reply(unknown, planId))).status).toBe(202);
    await test.runJobs();
    expect(contributionIds(test)).toEqual([]);
    expect(delivered(test)).toEqual([]);
  });

  it("is ignored for a reply to something other than one of our plans, and for a foreign object", async () => {
    const { test, planId, ben } = await setup();
    const cases = [
      reply(ben, planId, { n: 1, inReplyTo: `https://${HOST}/p/not-a-plan` }),
      reply(ben, planId, { n: 2, inReplyTo: `https://${HOST}/notes/some-note` }),
      reply(ben, planId, { n: 3, inReplyTo: `https://elsewhere.example/p/${planId}` }),
      reply(ben, planId, { n: 4, extra: { inReplyTo: undefined } }),
      reply(ben, planId, { n: 5, attributedTo: "https://social.example/users/zed" }),
      reply(ben, planId, { n: 6, noteId: "https://elsewhere.example/notes/6" }),
    ];
    const statuses: number[] = [];
    for (const activity of cases) statuses.push((await post(test, ben, activity)).status);
    // Fedify itself refuses an object of another server than the actor's (the last).
    expect(statuses).toEqual([202, 202, 202, 202, 202, 401]);
    await test.runJobs();
    expect(contributionIds(test)).toEqual([]);
    expect(delivered(test)).toEqual([]);
  });

  it("is ignored before the start, after the recap closed, and for a cancelled plan", async () => {
    const { test, host, planId, ben } = await setup();
    test.clock.set("2026-06-01T09:00:00Z");
    await post(test, ben, reply(ben, planId, { n: 1 }));
    test.clock.set("2026-06-20T06:00:00Z");
    await post(test, ben, reply(ben, planId, { n: 2 }));
    expect(contributionIds(test)).toEqual([]);
    // A cancelled plan: cancel on another plan before the start.
    test.clock.set("2026-06-01T09:00:00Z");
    const other = await createPlanViaUi(host, { title: "Other" });
    await post(test, ben, joinOf(ben, other.planId, 2));
    const page = await (await host.get(`/p/${other.planId}/host`)).text();
    await host.postForm(`/p/${other.planId}/host/cancel`, hiddenFields(page));
    test.clock.set(AFTER_START);
    await post(test, ben, reply(ben, other.planId, { n: 3 }));
    await test.runJobs();
    expect(contributionIds(test)).toEqual([]);
  });

  it("is ignored beyond 20 a person, and invalid or over-long text, and a link that is not http(s)", async () => {
    const { test, planId, ben } = await setup();
    const send = async (n: number, content: string) => {
      // A token every two minutes: the per-server limit is not what is tested here.
      test.clock.set(new Date(test.clock.now().getTime() + 130_000).toISOString());
      return post(test, ben, reply(ben, planId, { n, content }));
    };
    await send(100, "<p></p>");
    await send(101, `<p>${"x".repeat(1001)}</p>`);
    await send(102, `<p>ok <a href="https://t.example/${"y".repeat(2000)}">long link</a></p>`);
    expect(contributionIds(test)).toEqual([]);
    await send(103, `<p>${"y".repeat(1000)}</p>`);
    expect(contributionIds(test)).toHaveLength(1);
    for (let n = 0; n < 19; n++) await send(n, `<p>Contribution ${n}</p>`);
    expect(contributionIds(test)).toHaveLength(20);
    await send(104, "<p>One too many</p>");
    expect(contributionIds(test)).toHaveLength(20);
  });

  it("is one contribution however often the same Note arrives", async () => {
    const { test, planId, ben } = await setup();
    await post(test, ben, reply(ben, planId, { n: 1, noteId: `${ben.id}/statuses/same` }));
    await post(test, ben, reply(ben, planId, { n: 2, noteId: `${ben.id}/statuses/same` }));
    await test.runJobs();
    expect(contributionIds(test)).toHaveLength(1);
    expect(noteDeliveries(test, "Create")).toHaveLength(1);
    expect(JSON.parse(rows(test, "remote_contributions"))).toHaveLength(1);
  });

  it("changes nothing when unsigned or signed by another actor, also another one of the same server", async () => {
    const { test, planId, ben } = await setup();
    const mallory = await remotePerson(test, "mallory");
    // Mallory shares ben's server: only the signature and the Note's author stand between them.
    expect((await post(test, ben, reply(ben, planId), mallory)).status).toBe(401);
    const unsigned = await test.app.request("/inbox", {
      method: "POST",
      headers: { "content-type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        actor: ben.id,
        ...reply(ben, planId),
      }),
    });
    expect(unsigned.status).toBe(401);
    // Mallory signs as themselves, naming ben as the Note's author.
    expect(
      (await post(test, mallory, reply(mallory, planId, { attributedTo: ben.id }))).status,
    ).toBe(202);
    // And claims ben's Note address for their own.
    expect(
      (await post(test, mallory, reply(mallory, planId, { noteId: `${ben.id}/statuses/1` })))
        .status,
    ).toBe(202);
    await test.runJobs();
    expect(contributionIds(test)).toEqual([]);
    expect(delivered(test)).toEqual([]);
  });

  it("is edited by its author's Update, and by nobody else's", async () => {
    const { test, planId, ben, cat } = await setup();
    const noteId = `${ben.id}/statuses/edit`;
    await post(test, ben, reply(ben, planId, { noteId, content: "<p>First words</p>" }));
    await test.runJobs();
    test.federationHttp.posts.length = 0;
    // Cat, joined too, tries to edit ben's Note.
    await post(test, cat, updateOf(cat, planId, noteId, "<p>Hijacked</p>", 1));
    // Mallory on ben's server tries too.
    const mallory = await remotePerson(test, "mallory");
    await post(test, mallory, updateOf(mallory, planId, noteId, "<p>Hijacked too</p>", 2));
    expect(await contributionBodies(test)).toEqual(["First words"]);
    await post(test, ben, updateOf(ben, planId, noteId, "<p>Second words</p>", 3));
    expect(await contributionBodies(test)).toEqual(["Second words"]);
    await test.runJobs();
    // The change goes to cat as an Update of the Note cat holds.
    const updates = noteDeliveries(test, "Update");
    expect(updates).toHaveLength(1);
    expect(String(noteOf(updates[0])?.content)).toContain("Second words");
    // A public Update changes nothing.
    await post(test, ben, {
      ...updateOf(ben, planId, noteId, "<p>Public words</p>", 4),
      to: [PUBLIC],
      object: { ...updateOf(ben, planId, noteId, "<p>Public words</p>", 4).object, to: [PUBLIC] },
    });
    expect(await contributionBodies(test)).toEqual(["Second words"]);
  });

  it("is deleted by its author's Delete, with a Delete to the others, and by nobody else's", async () => {
    const { test, planId, ben, cat } = await setup();
    const noteId = `${ben.id}/statuses/gone`;
    await post(test, ben, reply(ben, planId, { noteId, content: "<p>Short lived</p>" }));
    await test.runJobs();
    const ids = contributionNoteIds(test);
    test.federationHttp.posts.length = 0;
    const mallory = await remotePerson(test, "mallory");
    await post(test, cat, deleteOf(noteId));
    await post(test, mallory, deleteOf(noteId));
    expect(contributionIds(test)).toHaveLength(1);
    await post(test, ben, deleteOf(noteId, 3));
    expect(contributionIds(test)).toEqual([]);
    await test.runJobs();
    const deletes = aboutNotes(test, "Delete", ids);
    expect(deletes.map((sent) => sent.url)).toEqual(["https://other.example/inbox"]);
    expect(rows(test, "contribution_notes")).toBe("[]");
    expect(rows(test, "remote_contributions")).toBe("[]");
  });

  it("goes with the author when their actor deletes itself", async () => {
    const { test, planId, ben } = await setup();
    await post(test, ben, reply(ben, planId, { content: "<p>Bye soon</p>" }));
    await test.runJobs();
    const ids = contributionNoteIds(test);
    test.federationHttp.posts.length = 0;
    await post(test, ben, { id: `${ben.id}#delete`, type: "Delete", object: ben.id });
    expect(contributionIds(test)).toEqual([]);
    await test.runJobs();
    expect(aboutNotes(test, "Delete", ids).map((sent) => sent.url)).toEqual([
      "https://other.example/inbox",
    ]);
  });
});

describe("the limit on replies from one server (spec 3.11, decision D45)", () => {
  /** Many people of one server, sharing one key: generating keys is slow. */
  async function crowd(test: TestApp, server: string, count: number): Promise<Remote[]> {
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

  it("takes a burst of 10 from one server, refuses the rest to be tried again, fetches and stores nothing for them, and leaves other servers alone", async () => {
    const { test, planId } = await setup();
    const noisy = await crowd(test, "noisy.example", 14);
    // They have joined (before the start): replies of those who have not cost nothing.
    test.clock.set("2026-06-01T08:00:00Z");
    for (const actor of noisy) {
      await joinRemote(test.planDeps, {
        planId,
        join: { id: `${actor.id}#join-1`, kind: "join" },
        actor: {
          id: actor.id,
          inbox: `${actor.id}/inbox`,
          sharedInbox: "https://noisy.example/inbox",
        },
        username: actor.id.split("/").at(-1),
        mayNotifyHost: () => true,
      });
    }
    test.clock.set(AFTER_START);
    // The Notes are only named, not embedded, so taking one costs a fetch.
    const statuses: number[] = [];
    const fetched = (url: string) =>
      test.federationHttp.requests.filter((u) => u.href === url).length;
    const costs: number[] = [];
    for (const [n, actor] of noisy.entries()) {
      const noteId = `${actor.id}/statuses/${n}`;
      test.federationHttp.respond(noteId, {
        headers: { "content-type": "application/activity+json" },
        body: JSON.stringify({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: noteId,
          type: "Note",
          attributedTo: actor.id,
          inReplyTo: planUri(planId),
          to: [INSTANCE],
          content: "<p>Fetched</p>",
        }),
      });
      const before = fetched(noteId);
      const activity = { ...reply(actor, planId, { n, noteId }), object: noteId };
      statuses.push((await post(test, actor, activity)).status);
      costs.push(fetched(noteId) - before);
    }
    expect(statuses.slice(0, 10).every((status) => status === 202)).toBe(true);
    // Refused with a failure, not "accepted", so the sending server tries again later.
    expect(statuses.slice(10).every((status) => status >= 500)).toBe(true);
    expect(costs.slice(0, 10)).toEqual(Array<number>(10).fill(1));
    expect(costs.slice(10)).toEqual([0, 0, 0, 0]);
    // Only the ten that were taken became contributions: nothing is stored for the refused.
    expect(contributionIds(test)).toHaveLength(10);
    const quiet = await person(test, "quiet", "quiet.example");
    expect((await post(test, quiet, reply(quiet, planId))).status).toBe(202);
    // Once the bucket refills the refused one is taken: it was not noted as processed.
    const [late] = noisy.slice(10);
    if (late === undefined) throw new Error("no refused actor");
    test.clock.set(new Date(test.clock.now().getTime() + 2 * 60 * 60 * 1000).toISOString());
    const noteId = `${late.id}/statuses/10`;
    expect(
      (await post(test, late, { ...reply(late, planId, { n: 10, noteId }), object: noteId }))
        .status,
    ).toBe(202);
  });

  it("is not spent by notes from actors who are not joined: they are not for us", async () => {
    const { test, planId, ida } = await setup();
    const statuses: number[] = [];
    for (let n = 0; n < 12; n++) {
      statuses.push((await post(test, ida, reply(ida, planId, { n }))).status);
    }
    expect(statuses).toEqual(Array<number>(12).fill(202));
    expect(contributionIds(test)).toEqual([]);
  });
});

describe("what holds a contribution's text (spec 3.11, 3.6)", () => {
  const SECRET = "Quokka-secret-words-7731";

  it("appears only in the Note bodies, the encrypted job payloads and the recap's encrypted columns", async () => {
    const { test, host, planId, ben } = await setup();
    await contribute(host, planId, `${SECRET} from the host`, "https://photos.example/quokka-7731");
    await post(test, ben, reply(ben, planId, { content: `<p>${SECRET} from ben</p>` }));
    const bodiesBefore = delivered(test).length;
    await test.runJobs();
    expect(bodiesBefore).toBe(0);
    // The plain text goes out in Note bodies only.
    for (const sent of delivered(test)) {
      const holdsText = JSON.stringify(sent.activity).includes(SECRET);
      expect(holdsText).toBe(
        isNoteActivity(sent.activity) && ["Create", "Update"].includes(String(sent.activity.type)),
      );
    }
    // Nowhere in the database file, in the clear: not in the job queue, Fedify's records, the
    // mappings or the Notes' rows, nor anywhere else.
    for (const table of [
      "job_queue",
      "fedify_kv",
      "remote_contributions",
      "contribution_notes",
      "responses",
      "recap_contributions",
    ]) {
      expect(rows(test, table)).not.toContain(SECRET);
      expect(rows(test, table)).not.toContain("quokka-7731");
    }
    const file = Buffer.from(test.database.sqlite.serialize());
    expect(file.includes(SECRET)).toBe(false);
    expect(file.includes("quokka-7731")).toBe(false);
  });

  it("is in no Event and no activity but the Notes', and the Note's address answers nothing", async () => {
    const { test, host, planId } = await setup();
    await contribute(host, planId, SECRET, "");
    await test.runJobs();
    const event = await test.app.request(`/p/${planId}`, {
      headers: { accept: "application/activity+json" },
    });
    expect(await event.text()).not.toContain(SECRET);
    const [create] = noteDeliveries(test, "Create");
    const path = new URL(String(noteOf(create)?.id)).pathname;
    const fetched = await test.app.request(path, {
      headers: { accept: "application/activity+json" },
    });
    expect(fetched.status).toBe(404);
    expect(await fetched.text()).not.toContain(SECRET);
  });

  it("is seen by the host, the participants who joined and the remote participants, and by no one else", async () => {
    const { test, host, planId, ida } = await setup();
    const wanda = new TestClient(test.app);
    test.clock.set("2026-06-01T08:00:00Z");
    await respondViaUi(wanda, planId, "Wanda", "joined");
    const interested = new TestClient(test.app);
    await respondViaUi(interested, planId, "Iris", "interested");
    test.clock.set(AFTER_START);
    await contribute(host, planId, SECRET, "");
    await test.runJobs();
    const seenBy = async (client: TestClient) =>
      section(await (await client.get(`/p/${planId}`)).text()).includes(SECRET);
    expect(await seenBy(host)).toBe(true);
    expect(await seenBy(wanda)).toBe(true);
    expect(await seenBy(interested)).toBe(false);
    expect(await seenBy(new TestClient(test.app))).toBe(false);
    // Remote: joined participants (Note), not interested Ida.
    const recipients = noteDeliveries(test, "Create").map((sent) => sent.url);
    expect(recipients.sort()).toEqual([
      "https://other.example/inbox",
      "https://social.example/inbox",
    ]);
    expect(recipients.some((url) => url.includes("third.example"))).toBe(false);
    expect(ida.id).toContain("ida");
  });
});

describe("with federation off", () => {
  it("sends nothing for a contribution and takes no replies", async () => {
    const test = await createTestApp({ env: { FEDERATION_ENABLED: "false" } });
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {});
    test.clock.set(AFTER_START);
    await contribute(host, planId, "Quiet", "");
    await test.runJobs();
    expect(test.federationHttp.posts).toEqual([]);
    const ben = await person(test, "ben");
    expect((await post(test, ben, reply(ben, planId))).status).toBeGreaterThanOrEqual(400);
    expect(contributionIds(test)).toHaveLength(1);
  });
});

const noteUri = (noteId: string) => `https://${HOST}/notes/${noteId}`;

/** The identifier of the contribution Note and of the exact-start Note sent to one remote person. */
async function notesSentTo(test: TestApp, planId: string, person: { id: string }) {
  const found = await test.planDeps.responses.findRemote(planId, person.id);
  const responseId = found?.response.id ?? "";
  const actors = test.planDeps.posterActors;
  return {
    contribution: (await actors?.contributionNotes.listByRecipient(responseId))?.[0]?.noteId ?? "",
    exactStart: (await actors?.notes.find(responseId))?.noteId ?? "",
  };
}

const commentsBy = async (test: TestApp, planId: string, person: { id: string }) => {
  const found = await test.planDeps.responses.findRemote(planId, person.id);
  return (await test.planDeps.recap.listByPlan(planId))
    .filter((c) => c.responseId === found?.response.id)
    .map((c) => c.body);
};

describe("a reply to one of our Notes (review of 12a)", () => {
  async function withNotes() {
    const setUp = await setupWithMallory();
    await contribute(setUp.host, setUp.planId, "Wanda's spicy comment", "");
    await setUp.test.runJobs();
    return setUp;
  }

  it("is a comment on its plan, when the person it was sent to answers the contribution Note or the exact-start Note", async () => {
    const { test, planId, ben, cat } = await withNotes();
    const toBen = await notesSentTo(test, planId, ben);
    const toCat = await notesSentTo(test, planId, cat);
    expect(toBen.contribution).not.toBe("");
    expect(toBen.exactStart).not.toBe("");
    const answered = await post(
      test,
      ben,
      reply(ben, planId, {
        n: 1,
        inReplyTo: noteUri(toBen.contribution),
        content: "<p>Ben on the comment</p>",
      }),
    );
    const answeredStart = await post(
      test,
      cat,
      reply(cat, planId, {
        n: 2,
        inReplyTo: noteUri(toCat.exactStart),
        content: "<p>Cat on the start</p>",
      }),
    );
    expect([answered.status, answeredStart.status]).toEqual([202, 202]);
    expect(await commentsBy(test, planId, ben)).toEqual(["Ben on the comment"]);
    expect(await commentsBy(test, planId, cat)).toEqual(["Cat on the start"]);
  });

  it("is ignored from another joined participant, spends nothing and stores nothing", async () => {
    const { test, planId, ben, mallory } = await withNotes();
    const toBen = await notesSentTo(test, planId, ben);
    const statuses: number[] = [];
    // More than the quota's burst: none of them may spend a token.
    for (let n = 1; n <= 14; n++) {
      statuses.push(
        (
          await post(
            test,
            mallory,
            reply(mallory, planId, {
              n,
              inReplyTo: noteUri(toBen.contribution),
              content: `<p>Hijack ${n}</p>`,
            }),
          )
        ).status,
      );
    }
    expect(statuses).toEqual(Array<number>(14).fill(202));
    expect(await commentsBy(test, planId, mallory)).toEqual([]);
    expect(await commentsBy(test, planId, ben)).toEqual([]);
    // Their own Note they may answer, so the quota was not spent by the others.
    const toMallory = await notesSentTo(test, planId, mallory);
    expect(
      (
        await post(
          test,
          mallory,
          reply(mallory, planId, {
            n: 20,
            inReplyTo: noteUri(toMallory.contribution),
            content: "<p>Mine</p>",
          }),
        )
      ).status,
    ).toBe(202);
    expect(await commentsBy(test, planId, mallory)).toEqual(["Mine"]);
  });

  it("is ignored for a Note that is not ours, and after the recipient left", async () => {
    const { test, planId, ben } = await withNotes();
    const toBen = await notesSentTo(test, planId, ben);
    await post(test, ben, reply(ben, planId, { n: 1, inReplyTo: noteUri("no-such-note") }));
    await post(test, ben, {
      id: `${ben.id}#leave-1`,
      type: "Leave",
      object: planUri(planId),
    });
    await post(test, ben, reply(ben, planId, { n: 2, inReplyTo: noteUri(toBen.contribution) }));
    // Only the host's own comment is there.
    expect(await contributionBodies(test)).toEqual(["Wanda's spicy comment"]);
  });
});

describe("the reply quota goes to replies that could count (review of 12a)", () => {
  it("is not spent by notes that are not for us, however many a server sends", async () => {
    const { test, planId, ben } = await setupWithMallory();
    const nobody = await person(test, "nobody");
    const unrelated = [
      // A public post that only mentions us, answering nothing.
      (n: number) => reply(ben, planId, { n, extra: { inReplyTo: undefined } }),
      // An answer to something that is none of our objects.
      (n: number) => reply(ben, planId, { n, inReplyTo: "https://elsewhere.example/status/1" }),
      (n: number) => reply(ben, planId, { n, inReplyTo: `https://${HOST}/p/not-a-plan` }),
      (n: number) => reply(ben, planId, { n, inReplyTo: noteUri("no-such-note") }),
      // From someone who has not joined, on the same server.
      (n: number) => reply(nobody, planId, { n }),
    ];
    const statuses: number[] = [];
    let n = 100;
    for (let round = 0; round < 4; round++) {
      for (const make of unrelated) {
        n += 1;
        const sender = make === unrelated[4] ? nobody : ben;
        statuses.push((await post(test, sender, make(n))).status);
      }
    }
    expect(statuses).toEqual(Array<number>(20).fill(202));
    // A real reply from the same server afterwards still goes through.
    expect(
      (await post(test, ben, reply(ben, planId, { n: 1, content: "<p>A real reply</p>" }))).status,
    ).toBe(202);
    expect(await commentsBy(test, planId, ben)).toEqual(["A real reply"]);
  });

  it("is spent by replies that could count, and the ones over the limit are refused to be tried again", async () => {
    const { test, planId, ben } = await setupWithMallory();
    const statuses: number[] = [];
    for (let n = 1; n <= 12; n++) {
      statuses.push(
        (await post(test, ben, reply(ben, planId, { n, content: `<p>Plausible ${n}</p>` }))).status,
      );
    }
    expect(statuses.slice(0, 10).every((status) => status === 202)).toBe(true);
    expect(statuses.slice(10).every((status) => status >= 500)).toBe(true);
    expect(await commentsBy(test, planId, ben)).toHaveLength(10);
  });
});

describe("whose Note it is (review of 12a)", () => {
  it("takes the author from the signer: a joined Mallory naming Ben as author changes nothing", async () => {
    const { test, planId, ben, mallory } = await setupWithMallory();
    expect(
      (await post(test, mallory, reply(mallory, planId, { n: 1, attributedTo: ben.id }))).status,
    ).toBe(202);
    expect(await commentsBy(test, planId, mallory)).toEqual([]);
    expect(await commentsBy(test, planId, ben)).toEqual([]);
    // The same Note under their own name counts, and as theirs.
    expect(
      (await post(test, mallory, reply(mallory, planId, { n: 2, attributedTo: mallory.id })))
        .status,
    ).toBe(202);
    expect(await commentsBy(test, planId, mallory)).toEqual(["Nice one"]);
    expect(await commentsBy(test, planId, ben)).toEqual([]);
  });
});
