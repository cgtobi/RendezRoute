// The 0.9 federation journey in a real browser against the built image (plan v1.0 step 13b1,
// decision D50): a host turns on a fediverse profile, a remote person (the fake fediverse server,
// fediverse.ts) follows it, joins a plan shared with followers and gets the exact start as a
// private direct message; deleting the plan sends `Delete` for the message and the event. Runs only
// in the "0.7 to 0.9 features" project; every name here carries the run, since the fakes container
// keeps its state across runs with E2E_KEEP.
import { expect, test } from "@playwright/test";
import { adminLogIn, inFiveDays, newInvite, oidcLogIn, person, useInvite } from "./helpers.ts";

const RUN = Date.now().toString(36);
const FAKES = "http://localhost:8080";
/** Where the browser reaches the fakes (it maps `fakes` to the local machine). */
const FAKES_HOST = "http://fakes:8080";
const APP = "http://localhost:3103";

interface Activity {
  type?: string;
  id?: string;
  to?: unknown;
  cc?: unknown;
  object?: { type?: string; id?: string; name?: string; content?: string } | string;
}
interface Received {
  inbox: string | null;
  headers: Record<string, string | string[] | undefined>;
  activity: Activity;
}

/** A fetch to the fakes that fails clearly when the fake is down or slow. */
async function fake(path: string, init?: RequestInit): Promise<Response> {
  const answer = await fetch(`${FAKES}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!answer.ok) throw new Error(`fakes ${path} answered ${answer.status}`);
  return answer;
}

/** Append-only. */
const received = async (to: string): Promise<Received[]> => {
  return (await (await fake(`/fedi/received?to=${to}`)).json()) as Received[];
};

/** Every delivery from the app is signed and carries a digest; a missing header fails by name. */
const expectSigned = (entries: Received[]) => {
  for (const entry of entries) {
    expect(entry.headers.signature, `signature on ${entry.activity.id}`).toBeTruthy();
    expect(entry.headers.digest, `digest on ${entry.activity.id}`).toBeTruthy();
  }
};

/** Polls the fake's inbox (the job runner delivers every 10 seconds) for a matching activity. */
async function waitFor(to: string, match: (activity: Activity) => boolean): Promise<Activity> {
  let found: Received | undefined;
  await expect
    .poll(
      async () => {
        found = (await received(to)).find((entry) => match(entry.activity));
        return found !== undefined;
      },
      { timeout: 45_000, intervals: [1_000] },
    )
    .toBe(true);
  if (found === undefined) throw new Error(`no matching activity for ${to}`);
  expectSigned([found]);
  return found.activity;
}

/** The address of an activity's object, whether it is embedded or a bare address. */
const objectId = (activity: Activity) =>
  typeof activity.object === "string" ? activity.object : activity.object?.id;

/** A `to` that may be one address or a list, as a list. */
const addresses = (value: unknown): string[] =>
  Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : [];

async function send(as: string, path: string, activity: Record<string, unknown>) {
  const answer = await fake("/fedi/send", {
    method: "POST",
    body: JSON.stringify({ as, path, activity }),
  });
  return (await answer.json()) as { status: number; body: string };
}

test("Federation: follow, a plan for followers, a remote join, a private exact start, deletion", async ({
  browser,
  baseURL,
}) => {
  // Each delivery waits for the job runner (every 10 seconds): six of them.
  test.setTimeout(180_000);
  const problems: string[] = [];
  const base = baseURL ?? "";
  const title = `Fediverse run ${RUN}`;
  const handle = `e2e_${RUN}`;
  const fan = `fan-${RUN}`;
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

  // 1. The host logs in and turns on the fediverse profile; WebFinger names the actor.
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
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

  const finger = await fetch(`${APP}/.well-known/webfinger?resource=acct:${handle}@localhost:3103`);
  expect(finger.status).toBe(200);
  const { links } = (await finger.json()) as { links: { rel: string; href: string }[] };
  const actor = links.find((link) => link.rel === "self")?.href ?? "";
  expect(actor).toMatch(/^http:\/\/localhost:3103\/actors\/[^/]+$/);
  const actorPath = new URL(actor).pathname;

  // 2. The remote person follows the actor; the app answers with an Accept to their inbox.
  const fanId = `http://fakes:8080/fedi/users/${fan}`;
  const follow = { id: `${fanId}#follow-1`, type: "Follow", object: actor };
  expect((await send(fan, `${actorPath}/inbox`, follow)).status).toBe(202);
  const accept = await waitFor(
    fan,
    (a) => a.type === "Accept" && JSON.stringify(a).includes(follow.id),
  );
  expect(addresses(accept.to)).toEqual([fanId]);
  await host.goto("/account");
  await expect(host.getByText("1 person in the fediverse follows you.")).toBeVisible();

  // 3. A plan for followers, with an exact start and a route: the followers get the Event with
  // its public details, and nothing the fake received holds the exact start or the route.
  // The inbox is append-only and a kept container holds earlier runs' (and late deliveries of an
  // aborted one), so only what arrives after this point counts.
  const oldLength = (await received(fan)).length;
  await host.goto("/new");
  await host.getByLabel("Your name").fill("Anna");
  await host.getByLabel("Title").fill(title);
  await host.getByLabel("Time zone").selectOption("UTC");
  await host.getByLabel("Date").fill(inFiveDays());
  await host.getByLabel("Start time").fill("08:30");
  await host.locator("#field-areaLabel").fill("Flaucher");
  await host.getByLabel("Where exactly?").fill(START);
  await host.getByLabel("Route (GPX file, optional)").setInputFiles({
    name: "run.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpx),
  });
  await host.getByLabel(/Followers of .* in the fediverse/).check();
  await host.getByRole("button", { name: "Create plan" }).click();
  await expect(host.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
  const planUrl = (await host.locator(".links .link-box a").textContent()) ?? "";
  expect(planUrl).toMatch(/^http:\/\/localhost:3103\/p\/[A-Za-z0-9_-]{22}$/);

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
  const secrets = [START, GPX_LAT, GPX_LNG, LATER_LAT_20, LATER_LAT_39, "/federation/notes/"];
  // Only this run's activities.
  const fresh = async () => {
    const entries = (await received(fan)).slice(oldLength);
    expectSigned(entries);
    return entries;
  };
  const everything = async () => JSON.stringify(await fresh());
  for (const secret of secrets) expect(await everything()).not.toContain(secret);
  // The exact start and the route reach nobody but the person, and only inside a Note.
  const onlyInNotesToFan = async () => {
    for (const entry of await fresh()) {
      const text = JSON.stringify(entry.activity);
      if (secrets.some((secret) => text.includes(secret))) {
        expect(entry.activity.object).toMatchObject({ type: "Note" });
        expect(addresses(entry.activity.to)).toEqual([fanId]);
      }
    }
  };

  // 4. The remote person joins (open mode: accepted at once): an Accept, then a direct Note to
  // them alone with the exact start; nobody else's inbox activity carries it.
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
  const noteId = objectId(note) ?? "";
  expect(new URL(noteId).pathname).toMatch(/^\/notes\//);
  expect(JSON.stringify(note)).toContain("/federation/notes/");
  await onlyInNotesToFan();
  // The host sees the remote participant by name (the account page and this one show the host
  // name without its port).
  await host.goto(`${planUrl}/host`);
  await expect(host.getByText(`${fan}@fakes`)).toBeVisible();

  // 5. Deleting the plan withdraws the Note and the Event.
  await host.getByRole("link", { name: "Delete plan…" }).click();
  await host.getByRole("button", { name: "Delete for good" }).click();
  await expect(host.getByText("This plan no longer exists.")).toBeVisible();
  await waitFor(fan, (a) => a.type === "Delete" && objectId(a) === noteId);
  await waitFor(fan, (a) => a.type === "Delete" && objectId(a) === planUrl);
  // Neither Delete (nor a Tombstone in it) gives the start or the route away.
  await onlyInNotesToFan();

  // Chrome logs the deliberate 404 of a deleted plan page as an error; nothing else may appear.
  expect(problems.filter((problem) => !problem.includes("404 (Not Found)"))).toEqual([]);
});
