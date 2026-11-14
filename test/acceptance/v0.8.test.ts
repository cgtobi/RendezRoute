// v0.8 acceptance criteria (spec 7, released as 0.8 by decision D21), one test named after each
// (spec 2b definition of done), through the web pages, with every optional channel configured
// against its fake.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { checkpoint, type Database } from "../../src/adapters/out/sqlite/database.ts";
import { translator } from "../../src/adapters/i18n/i18n.ts";
import { warnExpiringAccounts } from "../../src/application/account-data.ts";
import { FakeOidcServer } from "../fakes/oidc-server.ts";
import { createTestApp } from "../support/app.ts";
import { hiddenFields, TestClient } from "../support/client.ts";
import { escaped } from "../support/html.ts";
import { createPlanViaUi, editForm, respondViaUi } from "../support/plans.ts";
import { hasStandalone } from "../support/raw-scan.ts";

const en = translator("en");
const BASE = "https://runs.example.org";
const CHANNELS = {
  SMTP_HOST: "mail.example.org",
  SMTP_FROM: "runs@example.org",
  NTFY_URL: "https://ntfy.example.org",
  TELEGRAM_BOT_TOKEN: "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345",
};
const DAY_MS = 24 * 60 * 60 * 1000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The path of a channel's link (`/e/<token>`) in a message's text or URL. */
const channelLink = (text: string): string | undefined =>
  new RegExp(`${BASE.replaceAll(".", "\\.")}(/e/[A-Za-z0-9_-]+)`).exec(text)?.[1];

/** Every row of every table, to compare before and after (numbers included, not only text). */
function snapshot(database: Database): string {
  const tables = database.sqlite
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all() as { name: string }[];
  return JSON.stringify(
    tables.map(({ name }) => [name, database.sqlite.prepare(`select * from "${name}"`).all()]),
  );
}

describe("v0.8 acceptance criteria (spec 7)", () => {
  it("Every optional channel is confirmed before first use and can be turned off from every message it sends", async () => {
    const oidc = new FakeOidcServer();
    const test = await createTestApp({ env: { ...oidc.env(), ...CHANNELS }, oidc });
    const { app, mailer, ntfyClient, telegramClient, pressStart, runJobs, clock } = test;

    // Anna, logged in, hosts the plan; Ben responds.
    const anna = new TestClient(app);
    const start = new URL((await anna.get("/login/oidc")).headers.get("location") ?? "");
    const callback = oidc.approve(start, { sub: "anna", name: "Anna" });
    await anna.get(`${callback.pathname}${callback.search}`);
    const { planId } = await createPlanViaUi(anna);
    const ben = new TestClient(app);
    await respondViaUi(ben, planId, "Ben", "joined");
    const me = `/p/${planId}/me`;
    const hostPage = `/p/${planId}/host`;
    const post = async (client: TestClient, page: string, action: string, fields = {}) =>
      client.postForm(action, { _csrf: (await client.hiddenFields(page))._csrf ?? "", ...fields });

    // Every channel kind asks first: Ben's email, ntfy topic and Telegram chat, the host's
    // email for the plan, and the account's own email.
    await post(ben, me, `${me}/email`, { address: "ben@example.org" });
    await post(ben, me, `${me}/ntfy`);
    await post(ben, me, `${me}/telegram`);
    await post(anna, hostPage, `${hostPage}/email`, { address: "host@example.org" });
    await post(anna, "/account", "/account/email", { address: "anna@example.org" });
    const page = await (await ben.get(me)).text();
    const topic = /<code>https:\/\/ntfy\.example\.org\/([A-Za-z0-9_-]{43})<\/code>/.exec(page)?.[1];
    const startCode = /t\.me\/rendezroute_test_bot\?start=([A-Za-z0-9_-]+)/.exec(page)?.[1] ?? "";
    await runJobs();

    const mailsTo = (to: string) => () => mailer.sent.filter((mail) => mail.to === to);
    const channels = {
      benEmail: mailsTo("ben@example.org"),
      hostEmail: mailsTo("host@example.org"),
      accountEmail: mailsTo("anna@example.org"),
      ntfy: () => ntfyClient.published.filter((message) => message.topic === topic),
      telegram: () => telegramClient.sent,
    };
    const count = () => Object.values(channels).map((messages) => messages().length);

    // Before confirming, news reaches nobody: a change for Ben, a new participant for the host.
    const edit = async (title: string) => {
      await anna.postForm(hostPage, { ...(await editForm(anna, planId)), title });
      await runJobs();
    };
    await edit("Hill repeats, changed");
    await respondViaUi(new TestClient(app), planId, "Carla", "joined");
    await runJobs();
    // Only the confirmations: one email each, one ntfy post, nothing at all in Telegram.
    expect(count()).toEqual([1, 1, 1, 1, 0]);

    // Confirmed: the emailed and posted links, and Start in the bot.
    for (const message of [
      channels.benEmail()[0]?.text,
      channels.hostEmail()[0]?.text,
      channels.accountEmail()[0]?.text,
      channels.ntfy()[0]?.click,
    ]) {
      const confirm = await (await anna.get(channelLink(message ?? "") ?? "")).text();
      await anna.postForm("/e", { ...hiddenFields(confirm), action: "confirm" });
    }
    expect(await pressStart(startCode, "42")).toEqual({ kind: "confirmed" });

    // Then every kind of message: a change, a new participant, a new link by email, and the
    // account's expiry warning (housekeeping, 352 days on).
    await edit("Hill repeats, changed again");
    await respondViaUi(new TestClient(app), planId, "Dana", "joined");
    await runJobs();
    await ben.postForm(`${me}/link/email`, hiddenFields(await (await ben.get(me)).text()));
    clock.set(new Date(clock.now().getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts({ ...test.planDeps, identities: test.identities })).toBe(1);
    await runJobs();
    // Ben: confirmation, change, new link; the host: confirmation, Dana; the account:
    // confirmation, warning; ntfy and Telegram: confirmation, change.
    expect(count()).toEqual([3, 2, 2, 2, 2]);

    // Every message of a channel carries that channel's one link, whose page turns it off; an
    // email also in its List-Unsubscribe header, for the mail app's one click (RFC 8058).
    const emailLinks = (mails: () => { text: string; headers: Record<string, string> }[]) =>
      mails().flatMap((mail) => [mail.text, mail.headers["List-Unsubscribe"] ?? ""]);
    const linksOf = {
      benEmail: emailLinks(channels.benEmail),
      hostEmail: emailLinks(channels.hostEmail),
      accountEmail: emailLinks(channels.accountEmail),
      ntfy: channels
        .ntfy()
        .map((message) => [message.click, ...(message.actions ?? []).map((a) => a.url)].join(" ")),
      telegram: channels.telegram().map((message) => message.buttons.map((b) => b.url).join(" ")),
    };
    const linkOf: Record<string, string> = {};
    for (const [channel, texts] of Object.entries(linksOf)) {
      const links = new Set(texts.map(channelLink));
      // Named, so a failure says which channel.
      expect({ channel, links: links.size }).toEqual({ channel, links: 1 });
      const [link = ""] = links;
      const html = await (await new TestClient(app).get(link)).text();
      const turnsOff = html.includes('<input type="hidden" name="action" value="off"/>');
      expect({ channel, turnsOff }).toEqual({ channel, turnsOff: true });
      linkOf[channel] = link;
    }

    // Turned off: each email in one click from its last message's header, ntfy and Telegram on
    // the link page their last message opens.
    for (const messages of [channels.benEmail, channels.hostEmail, channels.accountEmail]) {
      const header = messages().at(-1)?.headers["List-Unsubscribe"] ?? "";
      const oneClick = await app.request(channelLink(header) ?? "", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      });
      expect(oneClick.status).toBe(200);
    }
    for (const link of [linkOf.ntfy, linkOf.telegram]) {
      const phone = new TestClient(app);
      const off = await phone.get(link ?? "");
      await phone.postForm("/e", { ...hiddenFields(await off.text()), action: "off" });
    }
    // Every channel is gone: its link names nothing any more.
    for (const link of Object.values(linkOf)) {
      expect((await new TestClient(app).get(link)).status).toBe(404);
    }
    const account = await (await anna.get("/account")).text();
    expect(account).not.toContain(escaped(en("email.accountOn", { address: "anna@example.org" })));
  });

  it("Nearby lists only `public` plans, never stores the viewer's location, and lists nothing when disabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-v08-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");
    const test = await createTestApp({
      env: { PUBLIC_REQUIRES_LOGIN: "false" },
      databasePath: path,
    });
    const anna = new TestClient(test.app);
    // The sample plan's public point is 48.16, 11.6.
    const listed = await createPlanViaUi(anna, { visibility: "public", title: "Listed run" });
    const linkOnly = await createPlanViaUi(anna, { title: "Link-only run" });
    const cancelled = await createPlanViaUi(anna, { visibility: "public", title: "Cancelled run" });
    const cancelForm = await (await anna.get(`/p/${cancelled.planId}/host`)).text();
    await anna.postForm(`/p/${cancelled.planId}/host/cancel`, hiddenFields(cancelForm));
    const noPoint = await createPlanViaUi(anna, {
      visibility: "public",
      title: "No point",
      exactLat: "",
      exactLng: "",
    });
    const past = await createPlanViaUi(anna, {
      visibility: "public",
      title: "Soon past",
      date: "2026-06-01",
      time: "12:00",
    });
    test.clock.set("2026-06-01T12:30:00Z");

    // The viewer's place, sent more precisely than the browser would, and a typed place.
    const before = snapshot(test.database);
    const viewer = new TestClient(test.app);
    const html = await (await viewer.get("/nearby?lat=48.16789&lng=11.61234&radius=10")).text();
    expect(html).toContain(`href="/p/${listed.planId}"`);
    for (const left of [linkOnly, cancelled, noPoint, past]) {
      expect(html).not.toContain(left.planId);
    }
    const typed = await viewer.get("/nearby?place=Flaucher&radius=25");
    const results = await (await viewer.get(typed.headers.get("location") ?? "")).text();
    expect(results).toContain(`href="/p/${listed.planId}"`);

    // Nothing stored: no row changed in any table, and no trace in the file, its WAL or the logs.
    expect(snapshot(test.database)).toBe(before);
    checkpoint(test.database);
    const raw = [path, `${path}-wal`]
      .map((file) => {
        try {
          return readFileSync(file).toString("latin1");
        } catch {
          return "";
        }
      })
      .join("");
    const logs = test.logs.join("\n");
    for (const trace of ["48.16789", "11.61234", "Flaucher"]) {
      expect(raw).not.toContain(trace);
      expect(logs).not.toContain(trace);
    }
    // The rounded points are short: in the file and in the logs (`"time":"…:48.126Z"`), a timestamp must not match.
    for (const rounded of ["48.12", "11.56"]) {
      expect(hasStandalone(raw, rounded)).toBe(false);
      expect(hasStandalone(logs, rounded)).toBe(false);
    }
    await test.database.close();

    // Disabled: even a plan that is public is listed nowhere: no page, no query, no link.
    const off = await createTestApp({
      env: { PUBLIC_REQUIRES_LOGIN: "false", NEARBY_ENABLED: "false" },
    });
    const offClient = new TestClient(off.app);
    // Made public while Nearby was still on (public is not offered while it is off).
    off.planDeps.publicPlansOffered = true;
    const unlisted = await createPlanViaUi(offClient, { visibility: "public", title: "Unlisted" });
    off.planDeps.publicPlansOffered = false;
    expect((await off.planDeps.plans.findById(unlisted.planId))?.visibility).toBe("public");
    expect((await offClient.get("/nearby?lat=48.16&lng=11.6")).status).toBe(404);
    expect(await (await offClient.get("/")).text()).not.toContain('href="/nearby"');
  });
});
