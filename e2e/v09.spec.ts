// The 0.9 federation journey in a real browser against the built image (plan v1.0 step 13b1,
// decision D50): a host turns on a fediverse profile, a remote person (the fake fediverse server,
// fediverse.ts) follows it, joins a plan shared with followers and gets the exact start as a
// private direct message; deleting the plan sends `Delete` for the message and the event. The
// fediverse direct-message notice (step 13b2, decision D51) is a part of the same test: a person
// logged in through the fake Mastodon server switches it on, gets one private first message and,
// after switching off, nothing more; the job-runner deliveries of the journey (every 10 seconds)
// are the wait that proves "nothing more", so one wait serves both. Runs only in the "0.7 to 0.9
// features" project; every name here carries the run, since the fakes container keeps its state
// across runs with E2E_KEEP.
import { expect, test } from "@playwright/test";
import {
  adminLogIn,
  fillHostName,
  inFiveDays,
  newInvite,
  oidcLogIn,
  openFold,
  openZoneLine,
  person,
  useInvite,
} from "./helpers.ts";
import {
  addresses,
  APP,
  expectSigned,
  FAKES_HOST,
  objectId,
  received,
  type Received,
  recipientsOf,
  send,
  waitFor,
} from "./federation.ts";

const RUN = Date.now().toString(36);

test("Federation: follow, a plan for followers, a remote join, a private exact start, deletion, fediverse messages", async ({
  browser,
  baseURL,
}) => {
  // Three delivery rounds wait for the job runner (every 10 seconds), plus the first message.
  test.setTimeout(180_000);
  const problems: string[] = [];
  const base = baseURL ?? "";
  const title = `Fediverse run ${RUN}`;
  const handle = `e2e_${RUN}`;
  const fan = `fan-${RUN}`;
  const dm = `dm-${RUN}`;
  const START = `Quokka kiosk by the weir ${RUN}`;
  const GPX_LAT = "47.11111";
  const GPX_LNG = "10.98765";
  // Later points of the route (lat + i * 0.001), which a fediverse payload must not carry either.
  const LATER_LAT_20 = (Number(GPX_LAT) + 20 * 0.001).toFixed(5);
  const LATER_LAT_39 = (Number(GPX_LAT) + 39 * 0.001).toFixed(5);
  const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="e2e" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Run</name><trkseg>${Array.from(
    { length: 40 },
    (_, i) => i,
  )
    .map(
      (i) =>
        `<trkpt lat="${(Number(GPX_LAT) + i * 0.001).toFixed(5)}" lon="${GPX_LNG}"><ele>${500 + i}</ele><time>2026-05-01T06:${String(i).padStart(2, "0")}:00Z</time></trkpt>`,
    )
    .join("")}</trkseg></trk></gpx>`;
  const fanId = `${FAKES_HOST}/fedi/users/${fan}`;
  const dmId = `${FAKES_HOST}/fedi/users/${dm}`;
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
  const dmProblems: string[] = [];
  const { page: dmPage, context: dmContext } = await person(browser, base, dmProblems);
  // Only the dm person's own inbox counts: the shared one carries other specs' deliveries too.
  const own = async () => (await received(dm)).filter((entry) => entry.inbox === dm);
  let dmOldLength = 0;
  let afterOff = 0;
  let actor = "";
  let planUrl = "";
  let oldLength = 0;
  let noteId = "";

  await test.step("Fediverse messages: a person logged in through a Mastodon server switches them on", async () => {
    // The fake Mastodon logs in the person of this run's own (the cookie, as for the OIDC fake).
    await dmContext.addCookies([{ name: "e2e-oidc-person", value: dm, url: FAKES_HOST }]);
    await dmPage.goto("/account");
    await dmPage.getByLabel("Your server").fill(FAKES_HOST);
    await dmPage.getByRole("button", { name: "Continue" }).click();
    await dmPage.getByRole("link", { name: "Continue to fakes:8080" }).click();
    await expect(dmPage.getByText("You are logged in.")).toBeVisible();
    await expect(dmPage.locator("#field-displayName")).toHaveValue(`Person ${dm}`);
    // Switch the channel on: the switch is in the closed "More ways to be notified" part.
    dmOldLength = (await received(dm)).length;
    await dmPage.getByText("More ways to be notified").click();
    await expect(dmPage.getByText("Fediverse messages", { exact: true })).toBeVisible();
    await dmPage.getByRole("button", { name: "Turn on fediverse messages" }).click();
    await expect(
      dmPage.getByText("Notices about your account come to you as direct messages"),
    ).toBeVisible();
    await expect(dmPage.getByRole("button", { name: "Turn off fediverse messages" })).toBeVisible();
  });

  await test.step("Host: log in, turn on the fediverse profile, WebFinger names the actor", async () => {
    await adminLogIn(admin);
    await useInvite(host, await newInvite(admin));
    // An OIDC person of this run's own: the fixed one is shared with v07, which deletes that
    // account while this runs (the fake OIDC provider reads the cookie, identity.ts).
    await host
      .context()
      .addCookies([{ name: "e2e-oidc-person", value: `host-${RUN}`, url: FAKES_HOST }]);
    await oidcLogIn(host);
    await host.goto("/account");
    await expect(
      host.getByText("Turning it on makes you discoverable in the fediverse"),
    ).toBeVisible();
    await host.getByLabel("Your name in the fediverse").fill(handle);
    await host.getByRole("button", { name: "Turn on my fediverse profile" }).click();
    // The account page shows the host without its port.
    await expect(host.getByText(`Your fediverse profile is @${handle}@localhost.`)).toBeVisible();

    const finger = await fetch(
      `${APP}/.well-known/webfinger?resource=acct:${handle}@localhost:3103`,
    );
    expect(finger.status).toBe(200);
    const { links } = (await finger.json()) as { links: { rel: string; href: string }[] };
    actor = links.find((link) => link.rel === "self")?.href ?? "";
    expect(actor).toMatch(/^http:\/\/localhost:3103\/actors\/[^/]+$/);
  });

  const followId = `${fanId}#follow-1`;
  await test.step("Follow: the remote person follows the actor and the host sees the count", async () => {
    const follow = { id: followId, type: "Follow", object: actor };
    expect((await send(fan, `${new URL(actor).pathname}/inbox`, follow)).status).toBe(202);
    await host.goto("/account");
    await expect(host.getByText("1 person in the fediverse follows you.")).toBeVisible();
  });

  await test.step("Plan for followers: created with an exact start and a route", async () => {
    // The inbox is append-only and a kept container holds earlier runs' (and late deliveries of an
    // aborted one), so only what arrives after this point counts.
    oldLength = (await received(fan)).length;
    await host.goto("/new");
    await fillHostName(host, "Anna");
    await host.getByLabel("Title").fill(title);
    await openZoneLine(host);
    await host.getByLabel("Time zone").selectOption("UTC");
    await host.getByLabel("Date").fill(inFiveDays());
    await host.getByLabel("Start time").fill("08:30");
    await host.locator("#field-areaLabel").fill("Flaucher");
    await openFold(host, "Exact meeting point");
    await host.getByLabel("Description of the meeting point").fill(START);
    await openFold(host, "Route, pace and note");
    await host.getByLabel("Route (GPX file, optional)").setInputFiles({
      name: "run.gpx",
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(gpx),
    });
    await openFold(host, "Who can join and find it");
    await host.getByLabel(/Followers of .* in the fediverse/).check();
    await host.getByRole("button", { name: "Create plan" }).click();
    await expect(host.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
    planUrl = (await host.locator(".links .link-box a").textContent()) ?? "";
    expect(planUrl).toMatch(/^http:\/\/localhost:3103\/p\/[A-Za-z0-9_-]{22}$/);
  });

  // Run-unique secrets (this run's start, route points): no delivery of this run may hold them
  // except a Note to the person alone. The Note link ("/federation/notes/") is also carried by
  // other parallel specs' Notes, so it is only checked on what names this person or their host's
  // followers (as recipient of the activity or of its object, or by inbox).
  const secrets = [START, GPX_LAT, GPX_LNG, LATER_LAT_20, LATER_LAT_39];
  // Names us: the fan's inbox, a recipient of the activity or its object (the fan or the host's
  // followers), or this run's own actor (a URL unique to the run) anywhere in the activity.
  const toUs = (entry: Received) =>
    entry.inbox === fan ||
    recipientsOf(entry.activity).some((address) =>
      [fanId, `${actor}/followers`].includes(address),
    ) ||
    JSON.stringify(entry.activity).includes(actor);
  const fresh = async () => {
    const entries = (await received(fan)).slice(oldLength);
    expectSigned(entries);
    return entries;
  };

  await test.step("Followers: an Accept for the Follow, and the Event with public details only", async () => {
    // One delivery round of the job runner serves both.
    const accept = await waitFor(
      fan,
      (a) => a.type === "Accept" && JSON.stringify(a).includes(followId),
    );
    expect(addresses(accept.to)).toEqual([fanId]);
    const created = await waitFor(
      fan,
      (a) => a.type === "Create" && typeof a.object === "object" && a.object.id === planUrl,
    );
    expect(created.object).toMatchObject({ type: "Event", name: title });
    // Addressed to the followers collection alone, never to the public.
    expect(addresses(created.to)).toEqual([`${actor}/followers`]);
    expect(addresses(created.cc)).toEqual([]);
    expect(JSON.stringify([created.to, created.cc])).not.toMatch(/Public/);
    // The Event carries the public area and start time, and only a coarse area point.
    const event = created.object as Record<string, unknown>;
    // 08:30 in the plan's zone (UTC, picked in the form), whatever zone the browser is in.
    expect(Date.parse(String(event.startTime))).toBe(Date.parse(`${inFiveDays()}T08:30:00Z`));
    expect(JSON.stringify(event.location)).toContain("Flaucher");
    // Only the coarse area point (rounded to two decimals), never a finer position.
    expect(event.location).toMatchObject({ type: "Place", name: "Flaucher" });
    expect(JSON.stringify(event.location)).not.toMatch(/\d\.\d{3,}/);
    // The app's own area point for this route (not the exact start), at two decimals.
    expect(event.location).toMatchObject({ latitude: 47.12, longitude: 10.99 });
    // Nothing of the exact start, the route or the Note's link in the Event.
    const text = JSON.stringify(created);
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toContain("/federation/notes/");
    // Nothing before the join carries a secret, whoever it was for, nor a note link in anything
    // that names us.
    const sofar = await fresh();
    expect(sofar.filter(toUs).length).toBeGreaterThan(0);
    for (const secret of secrets) expect(JSON.stringify(sofar)).not.toContain(secret);
    expect(JSON.stringify(sofar.filter(toUs))).not.toContain("/federation/notes/");
  });

  await test.step("Fediverse messages: one private first message, kept on after a reload, then off", async () => {
    // The first message: a Create of a Note to that person alone, signed, saying what it is for.
    const first = await waitFor(
      dm,
      (a) =>
        typeof a.object === "object" &&
        (a.object.content ?? "").includes("now come to you here, as direct messages") &&
        addresses(a.to).includes(dmId),
      dmOldLength,
    );
    expect(first.type).toBe("Create");
    const note = typeof first.object === "object" ? first.object : undefined;
    expect(note?.type).toBe("Note");
    expect(addresses(first.to)).toEqual([dmId]);
    expect(addresses(note?.to)).toEqual([dmId]);
    expect(addresses(first.cc)).toEqual([]);
    expect(addresses(note?.cc)).toEqual([]);
    const text = note?.content ?? "";
    expect(text).toContain("now come to you here, as direct messages");
    expect(text).toContain("Your server keeps direct messages; this site cannot delete them.");
    expect(text).toContain(
      "To turn them off, open your account page: http://localhost:3103/account",
    );
    // The Mention tag names the person.
    expect(JSON.stringify(note?.tag)).toContain(dmId);
    // Nothing public, and no place or time of any plan in it.
    const everything = JSON.stringify(first);
    expect(everything).not.toMatch(/Public/);
    expect(everything).not.toMatch(/startTime|latitude|longitude|\d\.\d{4,}|\/federation\/notes\//);

    // The page keeps the channel on after a reload.
    await dmPage.reload();
    // The fold opens by itself while a channel is on: no click here.
    await expect(dmPage.getByRole("button", { name: "Turn off fediverse messages" })).toBeVisible();
    await dmPage.getByRole("button", { name: "Turn off fediverse messages" }).click();
    // The fold is still open after switching off: no click.
    await expect(dmPage.getByRole("button", { name: "Turn on fediverse messages" })).toBeVisible();
    afterOff = (await own()).length;
  });

  await test.step("Remote join: an Accept, then a private Note with the exact start", async () => {
    const join = { id: `${fanId}#join-1`, type: "Join", object: planUrl };
    expect((await send(fan, "/inbox", join)).status).toBe(202);
    const joined = await waitFor(
      fan,
      (a) => a.type === "Accept" && JSON.stringify(a).includes(join.id),
    );
    expect(addresses(joined.to)).toEqual([fanId]);
    const note = await waitFor(
      fan,
      (a) =>
        (a.type === "Create" || a.type === "Update") &&
        typeof a.object === "object" &&
        a.object.type === "Note" &&
        (a.object.content ?? "").includes(START),
    );
    expect(addresses(note.to)).toEqual([fanId]);
    expect(addresses(note.cc)).toEqual([]);
    noteId = objectId(note) ?? "";
    expect(new URL(noteId).pathname).toMatch(/^\/notes\//);
    expect(JSON.stringify(note)).toContain("/federation/notes/");
    // The host sees the remote participant by name (the account page and this one show the host
    // name without its port).
    await host.goto(`${planUrl}/host`);
    await expect(host.getByText(`${fan}@fakes`)).toBeVisible();
  });

  await test.step("Deletion: the plan's Delete withdraws the Note and the Event", async () => {
    await host.getByRole("link", { name: "Delete plan…" }).click();
    await host.getByRole("button", { name: "Delete for good" }).click();
    await expect(host.getByText("This plan no longer exists.")).toBeVisible();
    await waitFor(fan, (a) => a.type === "Delete" && objectId(a) === noteId);
    await waitFor(fan, (a) => a.type === "Delete" && objectId(a) === planUrl);
  });

  await test.step("No leak: the exact start and the route reach nobody but the person, only in a Note", async () => {
    // Every delivery of the run, the Deletes (and their Tombstones) included.
    const all = await fresh();
    // Not vacuous: the Event, a Note to the person and both Deletes are in what is checked.
    const has = (match: (a: (typeof all)[number]["activity"]) => boolean) =>
      all.some((entry) => match(entry.activity));
    expect(has((a) => a.type === "Create" && objectId(a) === planUrl)).toBe(true);
    expect(
      has(
        (a) =>
          (a.type === "Create" || a.type === "Update") &&
          typeof a.object === "object" &&
          a.object.type === "Note" &&
          objectId(a) === noteId &&
          addresses(a.to).includes(fanId),
      ),
    ).toBe(true);
    expect(has((a) => a.type === "Delete" && objectId(a) === noteId)).toBe(true);
    expect(has((a) => a.type === "Delete" && objectId(a) === planUrl)).toBe(true);
    for (const entry of all) {
      const text = JSON.stringify(entry.activity);
      // A secret or the route link, in anything sent to us, is a Note to the person alone: the
      // activity and its object are addressed to [fanId] and to nobody else.
      const carries =
        secrets.some((secret) => text.includes(secret)) ||
        (toUs(entry) && text.includes("/federation/notes/"));
      if (carries) {
        expect(entry.activity.object).toMatchObject({ type: "Note" });
        expect(addresses(entry.activity.to)).toEqual([fanId]);
        expect(addresses(entry.activity.cc)).toEqual([]);
        for (const address of recipientsOf(entry.activity)) expect(address).toBe(fanId);
      }
    }
  });

  await test.step("Fediverse messages: switching off sent nothing more", async () => {
    // The runner delivered at least once since the switch-off (the join's Accept, the Note and
    // the Deletes were all queued after it), so a message would have arrived by now.
    const delivered = await own();
    expect(delivered).toHaveLength(afterOff);
    expect(
      delivered.filter((entry) => JSON.stringify(entry.activity).includes("Note")),
    ).toHaveLength(1);
    expectSigned(delivered);
    // The old messages test required a clean console for this person.
    expect(dmProblems).toEqual([]);
  });

  // Chrome logs the deliberate 404 of a deleted plan page as an error; nothing else may appear.
  expect(problems.filter((problem) => !problem.includes("404 (Not Found)"))).toEqual([]);
});
