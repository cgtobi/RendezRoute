// Incoming `Flag` activities as reports to the instance admin (spec 7 Moderation, "Fediverse
// reports"; decisions D22, D44, D45, D46; 0.9 step 12b): a signed `Flag` naming a plan's Event, or
// one of our contribution Notes sent to someone on the reporter's server, is stored like a web
// report; everything else is ignored silently and spends no quota; limits answer with a failure so
// the sender tries again; the reporter's actor and server are stored nowhere.
import { generateCryptoKeyPair } from "@fedify/fedify";
import { describe, expect, it, vi } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi } from "../../support/plans.ts";
import {
  HOST,
  INSTANCE,
  joinOf,
  post,
  remotePerson,
  rows,
  type Remote,
  type TestApp,
} from "../../support/remote-people.ts";

// Making RSA keys for the impostor is slow when the whole suite runs at once.
vi.setConfig({ testTimeout: 30_000 });

const en = translator("en");
const TOKEN = "admin-token-for-tests-0123456789abcdef";
const SMTP = { SMTP_HOST: "mail.example.org", SMTP_FROM: "runs@example.org" };
const AFTER_START = "2026-06-07T06:00:00Z";
const planUri = (planId: string) => `https://${HOST}/p/${planId}`;
const noteUri = (noteId: string) => `https://${HOST}/notes/${noteId}`;
const HOUR_MS = 60 * 60 * 1000;

/** The people of this file share one pair of keys: generating RSA keys is slow. */
let sharedKeys: Promise<Remote["keys"]> | undefined;
const person = async (test: TestApp, name: string, server = "social.example") =>
  remotePerson(
    test,
    name,
    server,
    await (sharedKeys ??= generateCryptoKeyPair("RSASSA-PKCS1-v1_5")),
  );

/**
 * A plan with Ben (social.example) and Cat (other.example) joined, and a comment of the host's
 * sent to both as a Note. `mod` reports from Ben's server, `zed` from a server nobody joined from.
 */
async function setup(env: Record<string, string> = { ADMIN_TOKEN: TOKEN }) {
  const test = await createTestApp({ env });
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host, {});
  // A second plan, made before the clock moves on.
  const { planId: other } = await createPlanViaUi(host, {});
  const ben = await person(test, "ben");
  const cat = await person(test, "cat", "other.example");
  await post(test, ben, joinOf(ben, planId));
  await post(test, cat, joinOf(cat, planId));
  test.clock.set(AFTER_START);
  const csrf = hiddenFields(await (await host.get(`/p/${planId}`)).text())._csrf ?? "";
  await host.postForm(`/p/${planId}/recap`, {
    _csrf: csrf,
    body: "Host comment 5521",
    linkUrl: "https://photos.example/run-5521",
  });
  await test.runJobs();
  test.federationHttp.posts.length = 0;
  const mod = await person(test, "mod");
  const zed = await person(test, "zed", "reporter.example");
  const notes = {
    toBen: await notesSentTo(test, planId, ben),
    toCat: await notesSentTo(test, planId, cat),
  };
  return { test, host, planId, other, ben, cat, mod, zed, notes };
}

/** The identifiers of the contribution Note and of the exact-start Note sent to one remote person. */
async function notesSentTo(test: TestApp, planId: string, who: { id: string }) {
  const found = await test.planDeps.responses.findRemote(planId, who.id);
  const responseId = found?.response.id ?? "";
  const actors = test.planDeps.posterActors;
  return {
    contribution: (await actors?.contributionNotes.listByRecipient(responseId))?.[0]?.noteId ?? "",
    exactStart: (await actors?.notes.find(responseId))?.noteId ?? "",
  };
}

/** A `Flag` as a Mastodon-like server posts it. */
const flagOf = (
  from: { id: string },
  objects: readonly string[],
  { n = 1, content = "Reported 3081" }: { n?: number; content?: string | null } = {},
) => ({
  id: `${from.id}#flag-${n}`,
  type: "Flag",
  to: [INSTANCE],
  object: objects,
  ...(content === null ? {} : { content }),
});

const reportsOf = (test: TestApp, planId: string) => test.planDeps.reports.listOpenForPlan(planId);
const reportCount = (test: TestApp) =>
  test.database.sqlite.prepare("select count(*) from reports").pluck().get() as number;
const alertJobs = (test: TestApp) =>
  test.database.sqlite
    .prepare("select count(*) from job_queue where type = 'reportAlert'")
    .pluck()
    .get() as number;

describe("a Flag naming a plan or one of our contribution Notes", () => {
  it("is one report for the plan's Event: reason other, the text as details, nothing attached", async () => {
    const { test, planId, zed } = await setup();
    const sent = await post(test, zed, flagOf(zed, [planUri(planId)], { content: "Spam 7741" }));
    expect(sent.status).toBe(202);
    const [report, ...more] = await reportsOf(test, planId);
    expect(more).toEqual([]);
    expect(report).toMatchObject({ planId, reason: "other", details: "Spam 7741", attached: [] });
    expect(reportCount(test)).toBe(1);
  });

  it("is one report when Home Assistant Ingress is the admin: an admin exists, so reporting is on (D56)", async () => {
    const { test, planId, zed } = await setup({
      ADMIN_INGRESS: "true",
      ADMIN_PORT: "3001",
      ADMIN_BIND: "0.0.0.0",
      ADMIN_INGRESS_SKIP_VERSION_CHECK: "true",
    });
    const sent = await post(test, zed, flagOf(zed, [planUri(planId)], { content: "Ingress 9930" }));
    expect(sent.status).toBe(202);
    expect((await reportsOf(test, planId)).map((r) => r.details)).toEqual(["Ingress 9930"]);
  });

  it("is one report when it names the account first and the Event after (Mastodon's shape)", async () => {
    const { test, planId, zed } = await setup();
    const sent = await post(
      test,
      zed,
      flagOf(zed, [`https://reporter.example/users/offender-4410`, planUri(planId)], {
        content: "Mastodon style 4410",
      }),
    );
    expect(sent.status).toBe(202);
    const found = await reportsOf(test, planId);
    expect(found.map((r) => r.details)).toEqual(["Mastodon style 4410"]);
  });

  it("is a report for the plan, with a copy of the contribution and no author, when it names a Note sent to someone on the reporter's server", async () => {
    const { test, planId, mod, notes } = await setup();
    const created = vi.spyOn(test.planDeps.reports, "create");
    const sent = await post(
      test,
      mod,
      flagOf(mod, [noteUri(notes.toBen.contribution)], { content: "On the note 6602" }),
    );
    // What is handed to the store holds no author already, whatever the store keeps.
    expect(created.mock.calls.map(([report]) => report.attached)).toEqual([
      [{ body: "Host comment 5521", linkUrl: "https://photos.example/run-5521" }],
    ]);
    expect(sent.status).toBe(202);
    const found = await reportsOf(test, planId);
    expect(found).toHaveLength(1);
    expect(found[0]?.details).toBe("On the note 6602");
    // Exactly the text and the link, not who wrote them.
    expect(found[0]?.attached).toEqual([
      { body: "Host comment 5521", linkUrl: "https://photos.example/run-5521" },
    ]);
  });

  it("is one report with the copy when it names the Note and the Event of the same plan, in either order", async () => {
    const { test, planId, mod, notes } = await setup();
    const note = noteUri(notes.toBen.contribution);
    await post(test, mod, flagOf(mod, [planUri(planId), note], { n: 1, content: "Event first" }));
    await post(
      test,
      mod,
      flagOf(mod, [`https://social.example/users/x`, note, planUri(planId)], {
        n: 2,
        content: "Note first",
      }),
    );
    const found = await reportsOf(test, planId);
    expect(found.map((r) => r.details ?? "").toSorted()).toEqual(["Event first", "Note first"]);
    expect(found.map((r) => r.attached)).toEqual([
      [{ body: "Host comment 5521", linkUrl: "https://photos.example/run-5521" }],
      [{ body: "Host comment 5521", linkUrl: "https://photos.example/run-5521" }],
    ]);
  });

  it("is a report for the first plan named, and no more than one report", async () => {
    const { test, planId, other, zed } = await setup();
    await post(
      test,
      zed,
      flagOf(zed, [planUri(other), planUri(planId)], { content: "First 9071" }),
    );
    expect((await reportsOf(test, other)).map((r) => r.details)).toEqual(["First 9071"]);
    expect(await reportsOf(test, planId)).toEqual([]);
    expect(reportCount(test)).toBe(1);
  });

  it("takes the first object that resolves, passing over actors, remote Notes and plans that are gone", async () => {
    const { test, planId, zed } = await setup();
    await post(
      test,
      zed,
      flagOf(
        zed,
        [
          "https://reporter.example/users/offender",
          "https://reporter.example/statuses/123",
          planUri("AAAAAAAAAAAAAAAAAAAAAA"),
          planUri(planId),
        ],
        { content: "Later one 2290" },
      ),
    );
    expect((await reportsOf(test, planId)).map((r) => r.details)).toEqual(["Later one 2290"]);
  });

  it("reduces HTML to text, cuts to 1,000 characters, strips bidi controls and leaves empty text without details", async () => {
    const { test, planId, zed } = await setup();
    const plan = [planUri(planId)];
    const flags = [
      flagOf(zed, plan, {
        n: 1,
        content: "<p>Hello &amp; <b>bye</b><br>again 8123</p><script>alert(1)</script>",
      }),
      flagOf(zed, plan, { n: 2, content: `${"a".repeat(1500)}TAIL` }),
      flagOf(zed, plan, { n: 3, content: "abc‮def⁦ghi 4417‏" }),
      flagOf(zed, plan, { n: 4, content: "" }),
      flagOf(zed, plan, { n: 5, content: null }),
    ];
    const statuses: number[] = [];
    for (const flag of flags) statuses.push((await post(test, zed, flag)).status);
    // From a server of its own, so the burst of the first is not used up.
    const big = await person(test, "big", "big.example");
    const huge = flagOf(big, plan, { n: 6, content: `<p>${"b".repeat(60_000)}</p>` });
    statuses.push((await post(test, big, huge)).status);
    expect(statuses).toEqual(Array<number>(6).fill(202));
    const details = (await reportsOf(test, planId)).map((r) => r.details);
    expect(details).toHaveLength(6);
    expect(details).toContain("Hello & bye\nagain 8123");
    expect(details).toContain("a".repeat(1000));
    expect(details).toContain("abcdefghi 4417");
    expect(details.filter((d) => d === undefined)).toHaveLength(2);
    // The 60,000-character one is cut to what a report holds, not refused.
    expect(details.map((d) => d?.length ?? 0).sort((x, y) => x - y)).toEqual([
      0, 0, 14, 22, 1000, 1000,
    ]);
  });

  it("attaches no copy when the Note named belongs to another plan than the Event reported", async () => {
    const { test, planId, other, mod, notes } = await setup();
    expect(notes.toBen.contribution).not.toBe("");
    await post(
      test,
      mod,
      flagOf(mod, [planUri(other), noteUri(notes.toBen.contribution)], { content: "Mixed 3394" }),
    );
    const onOther = await reportsOf(test, other);
    expect(onOther.map((r) => [r.details, r.attached])).toEqual([["Mixed 3394", []]]);
    expect(await reportsOf(test, planId)).toEqual([]);
    expect(reportCount(test)).toBe(1);
  });

  it("keeps a link of the text: after the text, once, from an anchor, an anchor that is the address or a bare address, with control characters gone", async () => {
    const { test, planId, zed } = await setup();
    const plan = [planUri(planId)];
    const contents = [
      '<p>See <a href="https://x.example/a">this</a> please</p>',
      '<p><a href="https://x.example/c">https://x.example/c</a></p>',
      "Look at https://x.example/b now",
      '<p>Odd <a href="https://x.example/d\u0007\u202E">link</a> 7712</p>',
      "No link 5530",
    ];
    for (const [n, content] of contents.entries()) {
      await post(test, zed, flagOf(zed, plan, { n, content }));
    }
    const details = (await reportsOf(test, planId)).map((r) => r.details ?? "");
    expect(details.toSorted()).toEqual(
      [
        "See this please\nhttps://x.example/a",
        "https://x.example/c",
        "Look at now\nhttps://x.example/b",
        "Odd link 7712\nhttps://x.example/d",
        "No link 5530",
      ].toSorted(),
    );
  });

  it("keeps details that grow when normalized: cut after NFC, so a report is never lost to the length check", async () => {
    const { test, planId, zed } = await setup();
    const plan = [planUri(planId)];
    // U+0958 and U+FB2C become two and three characters under NFC.
    await post(test, zed, flagOf(zed, plan, { n: 1, content: "\u0958".repeat(1000) }));
    await post(test, zed, flagOf(zed, plan, { n: 2, content: "\uFB2C".repeat(1000) }));
    const details = (await reportsOf(test, planId)).map((r) => Array.from(r.details ?? ""));
    expect(details.map((chars) => chars.length)).toEqual([1000, 1000]);
  });
});

describe("a Flag that is ignored", () => {
  it("with reporting off (no admin authentication) stores nothing, answers 2xx and spends no token", async () => {
    const { test, planId, zed } = await setup({});
    const statuses: number[] = [];
    for (let n = 1; n <= 8; n++) {
      statuses.push((await post(test, zed, flagOf(zed, [planUri(planId)], { n }))).status);
    }
    expect(statuses).toEqual(Array<number>(8).fill(202));
    expect(reportCount(test)).toBe(0);
    expect(alertJobs(test)).toBe(0);
  });

  it("names nothing that resolves: an actor, a remote Note, an unknown address, a plan that is gone", async () => {
    const { test, zed } = await setup();
    const named = [
      [`https://reporter.example/users/offender-1`],
      [`https://reporter.example/statuses/2`],
      [`https://elsewhere.example/p/3`],
      [planUri("AAAAAAAAAAAAAAAAAAAAAA")],
      [noteUri("00000000-0000-4000-8000-000000000000")],
      [INSTANCE],
      [],
    ];
    const statuses: number[] = [];
    for (const [n, objects] of named.entries()) {
      statuses.push((await post(test, zed, flagOf(zed, objects, { n }))).status);
    }
    expect(statuses).toEqual(Array<number>(named.length).fill(202));
    expect(reportCount(test)).toBe(0);
  });

  it("names a Note sent to someone on another server than the reporter's, or the exact-start Note", async () => {
    const { test, mod, zed, notes } = await setup();
    expect(notes.toCat.contribution).not.toBe("");
    expect(notes.toBen.contribution).not.toBe("");
    const statuses = [
      // Cat's comment, flagged from Ben's server; and from one nobody joined from.
      (await post(test, mod, flagOf(mod, [noteUri(notes.toCat.contribution)], { n: 1 }))).status,
      (await post(test, zed, flagOf(zed, [noteUri(notes.toBen.contribution)], { n: 2 }))).status,
      // The exact start is private to the person it was sent to, even from their own server.
      (await post(test, mod, flagOf(mod, [noteUri(notes.toBen.exactStart)], { n: 3 }))).status,
    ];
    expect(statuses).toEqual([202, 202, 202]);
    expect(notes.toBen.exactStart).not.toBe("");
    expect(reportCount(test)).toBe(0);
  });

  it("is not a report for a Note on the same host but another server's port or scheme", async () => {
    const { test, planId, notes } = await setup();
    expect(notes.toBen.contribution).not.toBe("");
    const imposter = await person(test, "mod", "social.example:8443");
    const sent = await post(
      test,
      imposter,
      flagOf(imposter, [noteUri(notes.toBen.contribution)], { n: 1 }),
    );
    expect(sent.status).toBe(202);
    expect(await reportsOf(test, planId)).toEqual([]);
  });

  it("names the plan only after more objects than are looked at", async () => {
    const { test, planId, zed } = await setup();
    const junk = (count: number) =>
      Array.from({ length: count }, (_, n) => `https://reporter.example/statuses/${n}`);
    const late = await post(
      test,
      zed,
      flagOf(zed, [...junk(10), planUri(planId)], { n: 1, content: "Too late" }),
    );
    expect(late.status).toBe(202);
    expect(reportCount(test)).toBe(0);
    // The tenth object still counts.
    await post(test, zed, flagOf(zed, [...junk(9), planUri(planId)], { n: 2, content: "In time" }));
    expect((await reportsOf(test, planId)).map((r) => r.details)).toEqual(["In time"]);
  });

  it("is not heard when unsigned or signed by someone else", async () => {
    const { test, planId, zed, mod } = await setup();
    const body = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      actor: zed.id,
      ...flagOf(zed, [planUri(planId)]),
    });
    const unsigned = await test.app.request("/inbox", {
      method: "POST",
      headers: { "content-type": "application/activity+json" },
      body,
    });
    expect(unsigned.status).toBe(401);
    const forged = await post(test, zed, flagOf(zed, [planUri(planId)], { n: 2 }), mod);
    expect(forged.status).toBe(401);
    expect(reportCount(test)).toBe(0);
  });
});

describe("the limits on Flags (spec 3.11, decision D46)", () => {
  /** People of other servers, one each: `s0.example`, `s1.example`, ... */
  async function reporters(test: TestApp, count: number) {
    return Promise.all(
      Array.from({ length: count }, (_, n) => person(test, "rep", `s${n}.example`)),
    );
  }

  it("takes a burst of 5 from one server, answers the 6th with a failure that stores nothing, and gives a token back with the hour", async () => {
    const { test, planId, zed } = await setup();
    const statuses: number[] = [];
    for (let n = 1; n <= 6; n++) {
      statuses.push(
        (await post(test, zed, flagOf(zed, [planUri(planId)], { n, content: `Burst ${n}` })))
          .status,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses[5]).toBeGreaterThanOrEqual(500);
    expect(reportCount(test)).toBe(5);
    expect(alertJobs(test)).toBe(0);
    // Not noted as processed: the same Flag is taken once a token is back (10 an hour).
    test.clock.set(new Date(test.clock.now().getTime() + 7 * 60 * 1000).toISOString());
    const again = await post(
      test,
      zed,
      flagOf(zed, [planUri(planId)], { n: 6, content: "Burst 6" }),
    );
    expect(again.status).toBe(202);
    expect(reportCount(test)).toBe(6);
    // And a second flag at once is over again: only one token came back.
    const next = await post(test, zed, flagOf(zed, [planUri(planId)], { n: 7 }));
    expect(next.status).toBeGreaterThanOrEqual(500);
    expect(reportCount(test)).toBe(6);
  });

  it("leaves other servers alone", async () => {
    const { test, planId, zed } = await setup();
    const [other] = await reporters(test, 1);
    if (other === undefined) throw new Error("no reporter");
    for (let n = 1; n <= 6; n++) await post(test, zed, flagOf(zed, [planUri(planId)], { n }));
    const fine = await post(test, other, flagOf(other, [planUri(planId)]));
    expect(fine.status).toBe(202);
    expect(reportCount(test)).toBe(6);
  });

  it("is not spent by Flags that name nothing of ours, however many a server sends", async () => {
    const { test, planId, zed, mod, notes } = await setup();
    expect(notes.toCat.contribution).not.toBe("");
    const statuses: number[] = [];
    for (let n = 1; n <= 14; n++) {
      const objects =
        n % 3 === 0
          ? [`https://reporter.example/users/offender`]
          : n % 3 === 1
            ? [planUri("AAAAAAAAAAAAAAAAAAAAAA")]
            : [noteUri(notes.toCat.contribution)];
      statuses.push((await post(test, zed, flagOf(zed, objects, { n }))).status);
    }
    // Also from Ben's server: a Note sent to someone else's server is not plausible there either.
    for (let n = 20; n <= 30; n++) {
      statuses.push(
        (await post(test, mod, flagOf(mod, [noteUri(notes.toCat.contribution)], { n }))).status,
      );
    }
    expect(statuses.every((status) => status === 202)).toBe(true);
    expect(reportCount(test)).toBe(0);
    // The real Flags still go through, five of them, and the sixth is over.
    const real: number[] = [];
    for (let n = 40; n <= 45; n++) {
      real.push((await post(test, zed, flagOf(zed, [planUri(planId)], { n }))).status);
    }
    expect(real.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(real[5]).toBeGreaterThanOrEqual(500);
    expect(reportCount(test)).toBe(5);
  });

  it("holds a plan to 10 an hour across servers, refuses the 11th with a failure and stores nothing, and spends nothing of that server's own", async () => {
    const { test, planId, other } = await setup();
    const [a, b, c] = await reporters(test, 3);
    if (a === undefined || b === undefined || c === undefined) throw new Error("no reporters");
    const statuses: number[] = [];
    for (let n = 1; n <= 5; n++)
      statuses.push((await post(test, a, flagOf(a, [planUri(planId)], { n }))).status);
    for (let n = 1; n <= 5; n++)
      statuses.push((await post(test, b, flagOf(b, [planUri(planId)], { n }))).status);
    expect(statuses).toEqual(Array<number>(10).fill(202));
    expect(reportCount(test)).toBe(10);
    const refused = await post(test, c, flagOf(c, [planUri(planId)], { n: 1 }));
    expect(refused.status).toBeGreaterThanOrEqual(500);
    expect(reportCount(test)).toBe(10);
    // The refused server's own burst is untouched: another plan takes its five.
    const own: number[] = [];
    for (let n = 2; n <= 6; n++)
      own.push((await post(test, c, flagOf(c, [planUri(other)], { n }))).status);
    expect(own).toEqual([202, 202, 202, 202, 202]);
    // An hour later the plan takes the refused Flag.
    test.clock.set(new Date(test.clock.now().getTime() + HOUR_MS).toISOString());
    const later = await post(test, c, flagOf(c, [planUri(planId)], { n: 1 }));
    expect(later.status).toBe(202);
    expect(await reportsOf(test, planId)).toHaveLength(11);
  });

  it("does not spend a plan's token when the reporter's own server is over its burst", async () => {
    const { test, planId } = await setup();
    const [a, b, c] = await reporters(test, 3);
    if (a === undefined || b === undefined || c === undefined) throw new Error("no reporters");
    for (let n = 1; n <= 5; n++) await post(test, a, flagOf(a, [planUri(planId)], { n }));
    for (let n = 1; n <= 4; n++) await post(test, b, flagOf(b, [planUri(planId)], { n }));
    expect(reportCount(test)).toBe(9);
    // The plan is at 9 of 10; the server over its own burst is refused and takes nothing of it.
    const over = await post(test, a, flagOf(a, [planUri(planId)], { n: 6 }));
    expect(over.status).toBeGreaterThanOrEqual(500);
    const last = await post(test, c, flagOf(c, [planUri(planId)], { n: 1 }));
    expect(last.status).toBe(202);
    expect(reportCount(test)).toBe(10);
  });
});

describe("what a Flag leaves behind (decision D22)", () => {
  it("stores no actor, address or server of the reporter, and alerts with nothing of it, at most once an hour", async () => {
    const { test, planId, zed } = await setup({ ADMIN_TOKEN: TOKEN, ...SMTP });
    for (let n = 1; n <= 2; n++) {
      await post(test, zed, flagOf(zed, [planUri(planId)], { n, content: `Quiet ${n} 9930` }));
    }
    expect(reportCount(test)).toBe(2);
    expect(alertJobs(test)).toBe(2);
    // The reports and the queue know nobody: not the actor, its address or its server.
    for (const table of ["reports", "job_queue", "responses", "plans", "recap_contributions"]) {
      for (const secret of ["reporter.example", "users/zed"]) {
        expect(rows(test, table)).not.toContain(secret);
      }
    }
    // Fedify keeps a signer's public key to check its later signatures, as the privacy notice
    // says; that is the one place the actor's address is, and only the key lives there.
    const kv = test.database.sqlite.prepare("select key, value from fedify_kv").all() as {
      key: string;
      value: string;
    }[];
    const holdingReporter = kv.filter((row) =>
      `${row.key}${row.value}`.includes("reporter.example"),
    );
    expect(holdingReporter.length).toBeGreaterThan(0);
    expect(holdingReporter.map((row) => (JSON.parse(row.key) as string[]).slice(0, 2))).toEqual(
      holdingReporter.map(() => ["_fedify", "publicKey"]),
    );
    await test.runJobs();
    // One email now; the second report's alert waits for the hour's end and names the count.
    expect(test.mailer.sent).toHaveLength(1);
    test.clock.advance({ minutes: 61 });
    await test.runJobs();
    expect(test.mailer.sent).toHaveLength(2);
    expect(test.mailer.sent[1]?.text).toContain(en("email.reportOpen", { count: 2 }));
    for (const mail of test.mailer.sent) {
      expect(`${mail.subject}${mail.text}${mail.html}`).not.toMatch(
        /9930|Quiet|reporter\.example|users\/zed/,
      );
    }
    expect(test.federationHttp.posts).toEqual([]);
  });

  it("is listed on the admin page like a report from the web", async () => {
    const { test, planId, zed } = await setup();
    await post(test, zed, flagOf(zed, [planUri(planId)], { content: "Seen by admin 6718" }));
    const admin = new TestClient(test.app);
    const fields = hiddenFields(await (await admin.get("/admin/login")).text());
    await admin.postForm("/admin/login", { ...fields, token: TOKEN });
    const home = (await (await admin.get("/admin/")).text()).replaceAll("&#39;", "'");
    expect(home).toContain(en("admin.openReports", { count: 1 }));
    const page = await (await admin.get(`/admin/plans/${planId}`)).text();
    expect(page).toContain("Seen by admin 6718");
    expect(page).toContain(en("report.reason.other"));
    expect(page).not.toContain("reporter.example");
  });
});

describe("the privacy notice on Flags", () => {
  it("is shown when federation and admin login are both on, and in no other case", async () => {
    const line = en("privacy.federationReports");
    const text = async (env: Record<string, string>) =>
      (await (await new TestClient((await createTestApp({ env })).app).get("/privacy")).text())
        .replaceAll("&#39;", "'")
        .replaceAll("&quot;", '"');
    expect(await text({ ADMIN_TOKEN: TOKEN })).toContain(line);
    expect(await text({})).not.toContain(line);
    expect(await text({ ADMIN_TOKEN: TOKEN, FEDERATION_ENABLED: "false" })).not.toContain(line);
  });
});
