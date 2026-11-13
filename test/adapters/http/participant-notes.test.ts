// Private direct Notes through the inboxes and the job queue (spec 7 ActivityPub, 3.6; decision
// D43; 0.9 step 11b): a remote participant who joined gets the exact start and the route in a
// signed direct Note addressed to them alone, the GPX behind a secret link that dies with the
// Note; changes are sent again; leaving, removal and plan deletion withdraw it.
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { sampleGpx } from "../../support/gpx.ts";
import { createPlanWithRouteViaUi, editForm, hostActsOn } from "../../support/plans.ts";
import {
  delivered,
  HOST,
  INSTANCE,
  isNoteActivity,
  joinOf,
  post,
  remotePerson,
  rows,
  type TestApp,
  tentativeOf,
} from "../../support/remote-people.ts";

const PLACE = "Kiosk by the river weir";
const PRIVATE = [PLACE, "48.20417", "11.70123"];
const EXACT = { exactDescription: PLACE, exactLat: "48.20417", exactLng: "11.70123" };
const GENERIC_404 = async (response: Response) => `${response.status} ${await response.text()}`;

/** A plan with a route and an exact start, hosted by a fresh browser. */
async function setup(overrides: Record<string, string> = {}) {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanWithRouteViaUi(
    host,
    { ...EXACT, distanceKm: "", ...overrides },
    sampleGpx({ lat: 47.11111 }),
  );
  return { test, host, planId };
}

/** The Note and the activity it was sent in, as delivered. */
const notesDelivered = (test: TestApp, type: "Create" | "Update" | "Delete") =>
  delivered(test).filter((sent) => sent.activity.type === type && isNoteActivity(sent.activity));

const tokenOf = (sent: { activity: Record<string, unknown> } | undefined) =>
  /\/federation\/notes\/([^/]+)\/route\.gpx/.exec(JSON.stringify(sent?.activity))?.[1] ?? "";

const linkPath = (token: string) => `/federation/notes/${token}/route.gpx`;

describe("the Note to a participant who joined", () => {
  it("is a signed Create addressed to that actor alone, after the Accept, with the exact start in plain text and the route attached", async () => {
    const { test, planId } = await setup();
    const ben = await remotePerson(test, "ben");
    await post(test, ben, joinOf(ben, planId));
    await test.runJobs();
    const sent = delivered(test);
    expect(sent.map((item) => item.activity.type)).toEqual(["Accept", "Create"]);
    const [accept, create] = sent;
    expect(create?.url).toBe("https://social.example/inbox");
    expect(create?.headers.signature).toContain(`keyId="${INSTANCE}#main-key"`);
    expect(create?.activity).toMatchObject({
      type: "Create",
      actor: INSTANCE,
      to: ben.id,
      object: {
        type: "Note",
        attributedTo: INSTANCE,
        to: ben.id,
        attachment: { type: "Document", mediaType: "application/gpx+xml" },
      },
    });
    for (const key of ["cc", "bto", "bcc"]) expect(create?.activity).not.toHaveProperty(key);
    const note = create?.activity.object as Record<string, unknown>;
    for (const key of ["cc", "bto", "bcc"]) expect(note).not.toHaveProperty(key);
    expect(JSON.stringify(create?.activity)).not.toContain("as:Public");
    const content = String(note.content);
    for (const text of [
      PLACE,
      "48.20417, 11.70123",
      "07:30",
      "Europe/Berlin",
      `https://${HOST}/p/${planId}`,
    ]) {
      expect(content).toContain(text);
    }
    expect(content).toContain("may keep copies");
    expect(note.id).toMatch(new RegExp(`^https://${HOST}/notes/[A-Za-z0-9_-]+$`));
    // The Accept tells them the same, in its summary.
    expect(String(accept?.activity.summary)).toContain("may keep copies");
    // The link is on this instance and unguessable.
    const token = tokenOf(create);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect((note.attachment as { url: string }).url).toBe(`https://${HOST}${linkPath(token)}`);
  });

  it("is not sent to someone interested or requesting, and goes out when the host accepts", async () => {
    const { test, host, planId } = await setup({ joinMode: "approval" });
    const cleo = await remotePerson(test, "cleo", "other.example");
    const dan = await remotePerson(test, "dan");
    await post(test, cleo, tentativeOf(cleo, planId));
    await post(test, dan, joinOf(dan, planId));
    await test.runJobs();
    expect(notesDelivered(test, "Create")).toEqual([]);
    expect((await hostActsOn(host, planId, "accept", "dan@social.example")).status).toBe(303);
    await test.runJobs();
    const [create] = notesDelivered(test, "Create");
    expect(create?.url).toBe("https://social.example/inbox");
    expect(create?.activity).toMatchObject({ to: dan.id });
    expect(JSON.stringify(create?.activity)).not.toContain(cleo.id);
  });

  it("holds no exact start and no route link in the database or the queue in the clear", async () => {
    const { test, planId } = await setup();
    const ben = await remotePerson(test, "ben");
    await post(test, ben, joinOf(ben, planId));
    const token = tokenOf(
      (await test.jobs.due(test.clock.now(), 100))
        .map((job) => ({
          activity: JSON.parse((job.payload as { body: string }).body) as Record<string, unknown>,
        }))
        .find((job) => JSON.stringify(job.activity).includes("/federation/notes/")),
    );
    expect(token).not.toBe("");
    for (const table of ["participant_notes", "job_queue", "responses", "fedify_kv"]) {
      const content = rows(test, table);
      expect(content).not.toContain(token);
      for (const secret of PRIVATE) expect(content).not.toContain(secret);
    }
    // The link is found by its keyed hash and kept encrypted.
    const [stored] = test.database.sqlite
      .prepare("select route_token_hmac, route_token_enc, content_hash from participant_notes")
      .all() as { route_token_hmac: string; route_token_enc: string; content_hash: string }[];
    expect(stored?.route_token_hmac).toBeTruthy();
    expect(stored?.route_token_enc).toBeTruthy();
    expect(stored?.content_hash).not.toContain("48.20417");
  });

  it("is not dereferenceable: the Note's address tells nothing", async () => {
    const { test, planId } = await setup();
    const ben = await remotePerson(test, "ben");
    await post(test, ben, joinOf(ben, planId));
    await test.runJobs();
    const note = notesDelivered(test, "Create")[0]?.activity.object as { id: string };
    const path = new URL(note.id).pathname;
    for (const headers of [{ accept: "application/activity+json" }, {}]) {
      const answer = await test.app.request(path, { headers });
      expect(answer.status).toBe(404);
      expect(await answer.text()).not.toContain(PLACE);
    }
  });
});

describe("a Note waiting to be tried again", () => {
  it("is never delivered after its Delete: the host removes the participant while their server is down", async () => {
    const { test, host, planId } = await setup();
    const ben = await remotePerson(test, "ben");
    await post(test, ben, joinOf(ben, planId));
    // Their server is down: the Accept and the Create wait in backoff.
    test.federationHttp.respond("https://social.example/inbox", { status: 503 });
    await test.runJobs();
    test.federationHttp.posts.length = 0;
    // Removed, the response stays (the person is blocked), and so do its queued jobs.
    await hostActsOn(host, planId, "remove", "ben@social.example");
    // Back up: the Delete is due now, the retries a little later.
    test.federationHttp.respond("https://social.example/inbox", { status: 202 });
    await test.runJobs();
    test.clock.set(new Date(test.clock.now().getTime() + 10 * 60 * 1000).toISOString());
    await test.runJobs();
    expect(notesDelivered(test, "Create")).toEqual([]);
    expect(notesDelivered(test, "Delete")).toHaveLength(1);
    // The Delete came first: nothing about the Note is sent after it.
    const types = delivered(test).map((sent) => sent.activity.type);
    expect(types.indexOf("Delete")).toBeLessThan(types.indexOf("Accept"));
    expect(types).not.toContain("Create");
  });
});

describe("the queue and the Accept", () => {
  it("keeps Create and Update jobs with their plan and response, and the Delete with neither", async () => {
    const { test, host, planId } = await setup();
    const ben = await remotePerson(test, "ben");
    await post(test, ben, joinOf(ben, planId));
    const jobs = () =>
      test.database.sqlite
        .prepare("select plan_id, response_id from job_queue order by rowid")
        .all() as { plan_id: string | null; response_id: string | null }[];
    // The Accept and the Create each go with the response they belong to.
    expect(jobs()).toHaveLength(2);
    expect(jobs().every((job) => job.plan_id === planId && job.response_id !== null)).toBe(true);
    await test.runJobs();
    await host.postForm(`/p/${planId}/host`, {
      ...(await editForm(host, planId)),
      exactDescription: "Boat house at the lock",
    });
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toEqual({ plan_id: planId, response_id: expect.any(String) });
    await test.runJobs();
    await post(test, ben, {
      id: `${ben.id}#undo`,
      type: "Undo",
      object: { ...joinOf(ben, planId), actor: ben.id },
    });
    expect(jobs()).toEqual([{ plan_id: null, response_id: null }]);
  });

  it("has the copies notice in an Accept's summary, but not in a Reject, which sends no Note", async () => {
    const { test, host, planId } = await setup({ joinMode: "approval" });
    const dan = await remotePerson(test, "dan");
    const eve = await remotePerson(test, "eve", "other.example");
    await post(test, dan, joinOf(dan, planId));
    await post(test, eve, joinOf(eve, planId));
    await hostActsOn(host, planId, "accept", "dan@social.example");
    await hostActsOn(host, planId, "reject", "eve@other.example");
    await test.runJobs();
    const answers = delivered(test).filter((sent) =>
      ["Accept", "Reject"].includes(String(sent.activity.type)),
    );
    const accept = answers.find((sent) => sent.activity.type === "Accept");
    const reject = answers.find((sent) => sent.activity.type === "Reject");
    expect(String(accept?.activity.summary)).toContain("may keep copies");
    expect(reject?.activity).not.toHaveProperty("summary");
    expect(notesDelivered(test, "Create").map((sent) => sent.url)).toEqual([
      "https://social.example/inbox",
    ]);
  });
});

describe("the secret link", () => {
  async function joined() {
    const context = await setup();
    const ben = await remotePerson(context.test, "ben");
    await post(context.test, ben, joinOf(ben, context.planId));
    await context.test.runJobs();
    const token = tokenOf(notesDelivered(context.test, "Create")[0]);
    return { ...context, ben, token };
  }

  it("serves the regenerated route to anyone with it, with headers that keep it private", async () => {
    const { test, token } = await joined();
    // No login, no signature, no cookie.
    const answer = await test.app.request(linkPath(token));
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toContain("application/gpx+xml");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.headers.get("x-robots-tag")).toContain("noindex");
    expect(answer.headers.get("referrer-policy")).toBe("no-referrer");
    expect(answer.headers.get("content-disposition")).toBe('attachment; filename="route.gpx"');
    const gpx = await answer.text();
    expect(gpx).toContain('lat="47.11111"');
    // Regenerated: the uploaded file's metadata is not in it (decision D12).
    expect(gpx).not.toContain("SENTINEL-device");
  });

  it("answers every other link, whatever the reason, with the same generic 404", async () => {
    const { test, host, planId, ben, token } = await joined();
    const unknown = await GENERIC_404(await test.app.request(linkPath("no-such-token")));
    expect(unknown.startsWith("404")).toBe(true);
    const wrongPath = await test.app.request(`/federation/notes/${token}/other.gpx`);
    expect(wrongPath.status).toBe(404);

    // Route replaced: the old link stops, the new one works.
    const csrf = (await host.hiddenFields(`/p/${planId}/host`))._csrf ?? "";
    await host.postMultipart(
      `/p/${planId}/host/route`,
      { _csrf: csrf },
      { gpx: { name: "new.gpx", content: sampleGpx({ lat: 46.22222 }) } },
    );
    await test.runJobs();
    expect(await GENERIC_404(await test.app.request(linkPath(token)))).toBe(unknown);
    const second = tokenOf(notesDelivered(test, "Update").at(-1));
    expect(second).not.toBe(token);
    expect(await (await test.app.request(linkPath(second))).text()).toContain('lat="46.22222"');

    // Route removed: nothing to serve.
    await host.postForm(`/p/${planId}/host/route/remove`, { _csrf: csrf });
    expect(await GENERIC_404(await test.app.request(linkPath(second)))).toBe(unknown);

    // Left, removed, deleted with the plan: the same.
    const other = await setup();
    const cleo = await remotePerson(other.test, "cleo");
    await post(other.test, cleo, joinOf(cleo, other.planId));
    await other.test.runJobs();
    const cleoToken = tokenOf(notesDelivered(other.test, "Create")[0]);
    expect((await other.test.app.request(linkPath(cleoToken))).status).toBe(200);
    await post(other.test, cleo, {
      id: `${cleo.id}#undo`,
      type: "Undo",
      object: { ...joinOf(cleo, other.planId), actor: cleo.id },
    });
    expect(await GENERIC_404(await other.test.app.request(linkPath(cleoToken)))).toBe(unknown);
    expect(ben.id).toContain("ben");
  });

  it("dies when the host removes the participant, and with the plan", async () => {
    const { test, host, planId, token } = await joined();
    expect((await test.app.request(linkPath(token))).status).toBe(200);
    await hostActsOn(host, planId, "remove", "ben@social.example");
    expect((await test.app.request(linkPath(token))).status).toBe(404);

    const second = await joined();
    const page = await (await second.host.get(`/p/${second.planId}/host`)).text();
    await second.host.postForm(`/p/${second.planId}/host/delete`, hiddenFields(page));
    expect((await second.test.app.request(linkPath(second.token))).status).toBe(404);
  });

  it("answers 404 while federation is off", async () => {
    const test = await createTestApp({ env: { FEDERATION_ENABLED: "false" } });
    const answer = await test.app.request(linkPath("any-token"));
    expect(answer.status).toBe(404);
    const generic = await createTestApp();
    expect(await answer.text()).toBe(
      await (await generic.app.request(linkPath("any-token"))).text(),
    );
  });

  it("is limited per client, a successful download counting like a miss", async () => {
    const { test, token } = await joined();
    const statuses = [(await test.app.request(linkPath(token))).status];
    for (let n = 0; n < 24; n++)
      statuses.push((await test.app.request(linkPath(`guess-${n}`))).status);
    // The hit used one of the 20: 19 misses fit after it, the rest are refused.
    expect(statuses[0]).toBe(200);
    expect(statuses.slice(1, 20).every((status) => status === 404)).toBe(true);
    expect(statuses.slice(20).every((status) => status === 429)).toBe(true);
    // Even the valid link is refused once the budget is gone.
    expect((await test.app.request(linkPath(token))).status).toBe(429);
  });
});

describe("changes and withdrawal", () => {
  async function joined() {
    const context = await setup();
    const ben = await remotePerson(context.test, "ben");
    await post(context.test, ben, joinOf(ben, context.planId));
    await context.test.runJobs();
    context.test.federationHttp.posts.length = 0;
    return { ...context, ben };
  }

  it("sends an Update of the same Note for a new exact start, none for a title", async () => {
    const { test, host, planId } = await joined();
    await host.postForm(`/p/${planId}/host`, {
      ...(await editForm(host, planId)),
      title: "Other title",
    });
    await test.runJobs();
    expect(notesDelivered(test, "Update")).toEqual([]);
    await host.postForm(`/p/${planId}/host`, {
      ...(await editForm(host, planId)),
      exactDescription: "Boat house at the lock",
    });
    await test.runJobs();
    const [update] = notesDelivered(test, "Update");
    expect(update?.activity).toMatchObject({
      type: "Update",
      to: expect.stringContaining("social.example/users/ben"),
    });
    const content = String((update?.activity.object as { content?: string } | undefined)?.content);
    expect(content).toContain("Boat house at the lock");
    expect(content).not.toContain(PLACE);
  });

  it("sends a Delete of the Note when the participant leaves, and when the plan is deleted", async () => {
    const { test, host, planId, ben } = await joined();
    await post(test, ben, {
      id: `${ben.id}#undo`,
      type: "Undo",
      object: { ...joinOf(ben, planId), actor: ben.id },
    });
    await test.runJobs();
    const [gone] = notesDelivered(test, "Delete");
    expect(gone?.activity).toMatchObject({
      type: "Delete",
      actor: INSTANCE,
      to: ben.id,
      object: { type: "Tombstone" },
    });
    expect(gone?.url).toBe("https://social.example/inbox");

    await post(test, ben, joinOf(ben, planId, 2));
    await test.runJobs();
    test.federationHttp.posts.length = 0;
    const page = await (await host.get(`/p/${planId}/host`)).text();
    await host.postForm(`/p/${planId}/host/delete`, hiddenFields(page));
    await test.runJobs();
    // The Delete outlives the plan, and still names the Note.
    expect(notesDelivered(test, "Delete")).toHaveLength(1);
  });

  it("keeps the exact start and route out of everything but the Note and its Update", async () => {
    const { test, host, planId, ben } = await joined();
    await host.postForm(`/p/${planId}/host`, {
      ...(await editForm(host, planId)),
      title: "Hill repeats",
    });
    await post(test, ben, tentativeOf(ben, planId, 2));
    await test.runJobs();
    for (const sent of delivered(test)) {
      const text = JSON.stringify(sent.activity);
      if (isNoteActivity(sent.activity) && sent.activity.type !== "Delete") continue;
      for (const secret of [...PRIVATE, "47.11111", "/federation/notes/"])
        expect(text).not.toContain(secret);
    }
    const event = JSON.stringify(
      await (
        await test.app.request(`/p/${planId}`, { headers: { accept: "application/activity+json" } })
      ).json(),
    );
    for (const secret of [...PRIVATE, "47.11111", "/federation/notes/"])
      expect(event).not.toContain(secret);
  });
});
