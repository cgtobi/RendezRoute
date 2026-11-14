// Recap and reports over the fediverse in a real browser against the built image (plan v1.0 step
// 13b2, decision D51): after a plan has really started the host adds to the recap, the remote
// participant (the fake fediverse server, fakes/fediverse.ts) gets it as a private Note and answers
// privately, the answer shows on the plan page under its name and goes with its `Delete`; a remote
// `Flag` reaches the admin as a report. Runs only in the "0.7 to 0.9 features" project, in a worker
// of its own; every name carries the run, since the fakes container keeps its state with E2E_KEEP.
import { expect, type Page, test } from "@playwright/test";
import { adminLogIn, inFiveDays, newInvite, oidcLogIn, person, useInvite } from "./helpers.ts";
import {
  addresses,
  APP,
  expectSigned,
  FAKES_HOST,
  INSTANCE,
  received,
  recipientsOf,
  send,
  waitFor,
} from "./federation.ts";

const RUN = Date.now().toString(36);

test("Recap: a contribution goes to the remote participant, whose private reply shows and can be deleted", async ({
  browser,
  baseURL,
}) => {
  // About 90 seconds for the start, then three or four deliveries that wait for the job runner.
  test.setTimeout(300_000);
  const problems: string[] = [];
  const base = baseURL ?? "";
  const title = `Recap run ${RUN}`;
  const handle = `rc_${RUN}`;
  const fan = `recapfan-${RUN}`;
  const fanId = `${FAKES_HOST}/fedi/users/${fan}`;
  const START = `Quokka kiosk at the lock ${RUN}`;
  const HOST_TEXT = `Host recap words ${RUN}`;
  const HOST_LINK = `https://example.org/photos/${RUN}`;
  const REPLY_TEXT = `Remote reply words ${RUN}`;
  const REPLY_LINK = `https://example.net/pictures/${RUN}`;

  // 1. The host logs in (a person of this run's own) and turns on the fediverse profile.
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
  await adminLogIn(admin);
  await useInvite(host, await newInvite(admin));
  await host
    .context()
    .addCookies([{ name: "e2e-oidc-person", value: `recaphost-${RUN}`, url: FAKES_HOST }]);
  await oidcLogIn(host);
  await host.goto("/account");
  await host.getByLabel("Your name in the fediverse").fill(handle);
  await host.getByRole("button", { name: "Turn on my fediverse profile" }).click();
  await expect(host.getByText(`Your fediverse profile is @${handle}@localhost.`)).toBeVisible();
  const finger = await fetch(`${APP}/.well-known/webfinger?resource=acct:${handle}@localhost:3103`);
  const { links } = (await finger.json()) as { links: { rel: string; href: string }[] };
  const actor = links.find((link) => link.rel === "self")?.href ?? "";
  expect(actor).toMatch(/^http:\/\/localhost:3103\/actors\/[^/]+$/);

  // 2. The remote person follows; the plan is created so that it starts about 90 seconds later.
  const follow = { id: `${fanId}#follow-1`, type: "Follow", object: actor };
  expect((await send(fan, `${new URL(actor).pathname}/inbox`, follow)).status).toBe(202);
  const oldLength = (await received(fan)).length;
  // The next full minute at least 90 seconds ahead, in UTC.
  const startsAt = Math.ceil((Date.now() + 90_000) / 60_000) * 60_000;
  const iso = new Date(startsAt).toISOString();
  await host.goto("/new");
  await host.getByLabel("Your name").fill("Anna");
  await host.getByLabel("Title").fill(title);
  await host.getByLabel("Time zone").selectOption("UTC");
  await host.getByLabel("Date").fill(iso.slice(0, 10));
  await host.getByLabel("Start time").fill(iso.slice(11, 16));
  await host.locator("#field-areaLabel").fill("Flaucher");
  await host.getByLabel("Where exactly?").fill(START);
  await host.getByLabel(/Followers of .* in the fediverse/).check();
  await host.getByRole("button", { name: "Create plan" }).click();
  await expect(host.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
  const planUrl = (await host.locator(".links .link-box a").textContent()) ?? "";
  expect(planUrl).toMatch(/^http:\/\/localhost:3103\/p\/[A-Za-z0-9_-]{22}$/);

  // 3. The remote person joins (open mode: accepted at once) and gets the exact start in a Note.
  const join = { id: `${fanId}#join-1`, type: "Join", object: planUrl };
  expect((await send(fan, "/inbox", join)).status).toBe(202);
  await waitFor(fan, (a) => a.type === "Accept" && JSON.stringify(a).includes(join.id), oldLength);
  await waitFor(
    fan,
    (a) => typeof a.object === "object" && (a.object.content ?? "").includes(START),
    oldLength,
  );

  // 4. Wait for the start on the server's clock: reload until the recap form is there.
  await host.goto(planUrl);
  await expect(async () => {
    await host.reload();
    await expect(host.locator("#field-body")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: startsAt - Date.now() + 60_000, intervals: [5_000] });

  // 5. The host adds to the recap; the remote participant gets it as a private Note.
  const sinceContribution = (await received(fan)).length;
  await host.locator("#field-body").fill(HOST_TEXT);
  await host.locator("#field-linkUrl").fill(HOST_LINK);
  await host.getByRole("button", { name: "Add", exact: true }).click();
  await expect(host.getByText(HOST_TEXT)).toBeVisible();
  const note = await waitFor(
    fan,
    (a) => typeof a.object === "object" && (a.object.content ?? "").includes(HOST_TEXT),
    sinceContribution,
  );
  expect(note.type).toBe("Create");
  const contribution = typeof note.object === "object" ? note.object : undefined;
  expect(contribution?.type).toBe("Note");
  expect(contribution?.inReplyTo).toBe(planUrl);
  // Addressed to the one person, in the activity and in the Note; no copy, no public.
  expect(addresses(note.to)).toEqual([fanId]);
  expect(addresses(contribution?.to)).toEqual([fanId]);
  expect(addresses(note.cc)).toEqual([]);
  expect(addresses(contribution?.cc)).toEqual([]);
  // What the Note really says: the author as the web shows it, the comment, the link written out,
  // the plan page, in the plan's language (English); nothing of the exact start.
  const text = contribution?.content ?? "";
  for (const part of [
    "Anna wrote in the recap:",
    HOST_TEXT,
    `Link: ${HOST_LINK}`,
    `Plan page: ${planUrl}`,
    "Your server may keep copies of this message.",
  ]) {
    expect(text).toContain(part);
  }
  expect(JSON.stringify(note)).not.toContain(START);
  const contributionId = contribution?.id ?? "";
  expect(new URL(contributionId).pathname).toMatch(/^\/notes\//);

  // 6. The remote person answers privately, to the instance actor, in reply to the Note.
  const reply = {
    id: `${fanId}/statuses/1/activity`,
    type: "Create",
    to: [INSTANCE],
    cc: [],
    object: {
      id: `${fanId}/statuses/1`,
      type: "Note",
      attributedTo: fanId,
      inReplyTo: contributionId,
      to: [INSTANCE],
      cc: [],
      content: `<p>${REPLY_TEXT} <a href="${REPLY_LINK}" rel="nofollow noopener">${REPLY_LINK}</a></p>`,
      published: new Date().toISOString(),
    },
  };
  expect((await send(fan, "/inbox", reply)).status).toBe(202);
  // It shows on the plan page under the name web participants see (no port), with its link.
  const shown = host.locator(".contribution").filter({ hasText: REPLY_TEXT });
  await expect(async () => {
    await host.reload();
    await expect(shown).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 45_000, intervals: [2_000] });
  await expect(shown.locator(".contribution-author")).toContainText(
    new RegExp(`${fan}@fakes(?!:)`),
  );
  await expect(shown.getByRole("link", { name: REPLY_LINK })).toHaveAttribute("href", REPLY_LINK);

  // 7. Deleting the reply takes it off the page.
  const gone = {
    id: `${fanId}/statuses/1/delete`,
    type: "Delete",
    to: [INSTANCE],
    object: { id: `${fanId}/statuses/1`, type: "Tombstone" },
  };
  expect((await send(fan, "/inbox", gone)).status).toBe(202);
  await expect(async () => {
    await host.reload();
    await expect(shown).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 45_000, intervals: [2_000] });
  // The host's own contribution is still there.
  await expect(host.getByText(HOST_TEXT)).toBeVisible();

  // 8. Everything this run delivered is signed, addressed to the person or their followers
  // collection alone and never public; the exact start is only in the Note that carries it, and
  // the reply never goes back to its author.
  // The shared inbox also records other specs' deliveries to their people. Run-unique text and
  // "never public" are checked on every delivery after the snapshot; only the recipient check is
  // limited to what names this person or their host's followers.
  const ours = [fanId, `${actor}/followers`];
  const delivered = (await received(fan)).slice(oldLength);
  expect(delivered.length).toBeGreaterThan(0);
  expectSigned(delivered);
  for (const entry of delivered) {
    expect(JSON.stringify(entry.activity), `public in ${entry.activity.id}`).not.toMatch(/Public/);
    const toUs =
      entry.inbox === fan || recipientsOf(entry.activity).some((address) => ours.includes(address));
    if (toUs) {
      for (const address of recipientsOf(entry.activity)) {
        expect(ours).toContain(address);
      }
    }
    const mentionsStart = JSON.stringify(entry.activity).includes(START);
    if (mentionsStart) {
      expect(entry.activity.object).toMatchObject({ type: "Note" });
      expect(addresses(entry.activity.to)).toEqual([fanId]);
      expect(addresses(entry.activity.cc)).toEqual([]);
    }
    expect(JSON.stringify(entry.activity)).not.toContain(REPLY_TEXT);
  }

  // Chrome logs nothing here; no foreign request, no console error.
  expect(problems).toEqual([]);
});

/** Opens the admin's page for a plan from the home page's open reports; waits for the report. */
async function openReportedPlan(admin: Page, title: string) {
  await expect(async () => {
    await admin.goto("/admin/");
    await expect(admin.getByRole("link", { name: title })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 45_000, intervals: [2_000] });
}

// Flag limits are kept in memory per signer origin (a burst of 5, then 10 an hour): a sixth quick
// run on unchanged kept containers fails until the app container is restarted.
test("Flag: a remote report of a plan reaches the admin without its sender", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  const base = baseURL ?? "";
  const title = `Flagged run ${RUN}`;
  const reporter = `flagger-${RUN}`;
  const REASON = `Spam in the fediverse ${RUN}`;
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
  await adminLogIn(admin);
  await useInvite(host, await newInvite(admin));
  await host.getByLabel("Your name").fill("Anna");
  await host.getByLabel("Title").fill(title);
  await host.getByLabel("Date").fill(inFiveDays());
  await host.getByLabel("Start time").fill("08:30");
  await host.locator("#field-areaLabel").fill("Flaucher");
  await host.getByRole("button", { name: "Create plan" }).click();
  await expect(host.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
  const planUrl = (await host.locator(".links .link-box a").textContent()) ?? "";

  // A signed Flag naming the plan's Event, from a person on a server of its own.
  const flag = {
    id: `${FAKES_HOST}/fedi/users/${reporter}#flag-1`,
    type: "Flag",
    to: [INSTANCE],
    object: [planUrl],
    content: REASON,
  };
  expect((await send(reporter, "/inbox", flag)).status).toBe(202);

  // The report is among the open reports; the plan's page shows the reason "other" and the text.
  await openReportedPlan(admin, title);
  const home = await admin.content();
  await admin.getByRole("link", { name: title }).click();
  await expect(admin.getByText("Something else")).toBeVisible();
  await expect(admin.getByText(REASON)).toBeVisible();
  await expect(admin.getByText("1 open report")).toBeVisible();
  // Nobody is named: neither the person nor its server appears on the admin's pages.
  const planPage = await admin.content();
  for (const page of [home, planPage]) {
    expect(page).not.toContain(reporter);
    expect(page).not.toContain("fakes");
  }
  // Resolving works as for a web report.
  await admin.getByRole("button", { name: "Mark as resolved" }).click();
  await expect(admin.getByText("1 resolved report")).toBeVisible();
  expect(problems).toEqual([]);
});
