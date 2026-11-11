// The fediverse profile through the pages and ActivityPub (spec 7; decisions D36, D37; plan v1.0
// step 9b): turned on from the account page, found by WebFinger as a Person, a profile page for
// browsers, followers plans attributed to it, and retired for good when turned off.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { FakeOidcServer } from "../../fakes/oidc-server.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi } from "../../support/plans.ts";

const en = translator("en");
const AP = { accept: "application/activity+json" };
const HOST = "runs.example.org";

async function setup(env: Record<string, string> = {}) {
  const oidc = new FakeOidcServer();
  const test = await createTestApp({ env: { ...oidc.env(), ...env }, oidc });
  const logIn = async (sub: string, name: string) => {
    const client = new TestClient(test.app);
    const started = await client.get("/login/oidc");
    const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), { sub, name });
    await client.get(`${callback.pathname}${callback.search}`);
    return client;
  };
  return { ...test, logIn, anna: await logIn("anna", "Anna Müller") };
}

async function turnOn(anna: TestClient, handle: string) {
  const hidden = await anna.hiddenFields("/account");
  return anna.postForm("/account/profile", { _csrf: hidden._csrf ?? "", handle });
}

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

describe("turning the profile on (decision D36)", () => {
  it("shows what it means first, with a handle suggested from the display name", async () => {
    const { anna } = await setup();
    const page = await (await anna.get("/account")).text();
    expect(page).toContain(escaped(en("profile.notice")));
    expect(page).toContain('name="handle"');
    expect(page).toContain('value="anna_muller"');
    const off = await setup({ FEDERATION_ENABLED: "false" });
    expect(await (await off.anna.get("/account")).text()).not.toContain('name="handle"');
  });

  it("makes the account a Person found by WebFinger, with a profile page for browsers", async () => {
    const { app, anna } = await setup();
    const on = await turnOn(anna, "anna");
    expect(on.headers.get("location")).toBe("/account?profileOn#profile");
    expect(await (await anna.get("/account")).text()).toContain(
      escaped(en("profile.on", { handle: `@anna@${HOST}` })),
    );

    const finger = await json(
      await app.request(`/.well-known/webfinger?resource=acct:anna@${HOST}`),
    );
    const self = (finger.links as { rel: string; href: string }[]).find((l) => l.rel === "self");
    const actorPath = new URL(self?.href ?? "").pathname;
    const person = await json(await app.request(actorPath, { headers: AP }));
    expect(person).toMatchObject({
      type: "Person",
      preferredUsername: "anna",
      name: "Anna Müller",
      url: `https://${HOST}/@anna`,
      inbox: `https://${HOST}${actorPath}/inbox`,
    });
    expect(person.publicKey).toMatchObject({ owner: `https://${HOST}${actorPath}` });
    // A browser following the actor's address lands on the profile page.
    const browser = await app.request(actorPath);
    expect(browser.headers.get("location")).toBe("/@anna");
    // WebFinger in any case, as servers may pass on what people typed.
    const typed = await json(
      await app.request(`/.well-known/webfinger?resource=acct:Anna@${HOST}`),
    );
    expect(typed.links).toContainEqual(expect.objectContaining({ rel: "self", href: self?.href }));

    const { planId } = await createPlanViaUi(anna, { visibility: "public", title: "Hill repeats" });
    const profile = await (await new TestClient(app).get("/@anna")).text();
    expect(profile).toContain("Anna Müller");
    expect(profile).toContain(`href="/p/${planId}"`);
  });

  it("refuses a handle that is malformed or taken, saying why", async () => {
    const { anna } = await setup();
    const bad = await turnOn(anna, "anna.m");
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain(escaped(en("field.handle_invalid")));
  });

  it("is limited per client, counting only profiles made (spec 3.11)", async () => {
    const { anna, logIn } = await setup();
    // Refused handles make no keys and do not count.
    for (let i = 0; i < 6; i++) expect((await turnOn(anna, "admin")).status).toBe(422);
    for (let i = 0; i < 5; i++) {
      const someone = await logIn(`runner${i}`, `Runner ${i}`);
      expect((await turnOn(someone, `runner${i}`)).status).toBe(303);
    }
    const limited = await turnOn(anna, "anna");
    expect(limited.status).toBe(429);
  });
});

describe("followers plans (decisions D35, D37)", () => {
  it("are offered once there is a profile, and their Event is attributed to the poster's actor", async () => {
    const { app, anna } = await setup();
    const before = await (await anna.get("/new")).text();
    expect(before).toContain('name="visibility" value="followers" disabled=""');
    expect(before).toContain(escaped(en("form.followersNeedsProfile")));
    await turnOn(anna, "anna");
    const after = await (await anna.get("/new")).text();
    expect(after).toContain(escaped(en("form.visibilityFollowers", { handle: `@anna@${HOST}` })));
    expect(after).not.toContain('name="visibility" value="followers" disabled=""');

    const { planId } = await createPlanViaUi(anna, { visibility: "followers" });
    const event = await json(await app.request(`/p/${planId}`, { headers: AP }));
    const person = await json(await app.request(event.attributedTo as string, { headers: AP }));
    expect(person.preferredUsername).toBe("anna");
  });
});

describe("turning the profile off (decision D37)", () => {
  it("leaves the actor gone, the handle retired and followers plans link-only", async () => {
    const { app, anna } = await setup();
    await turnOn(anna, "anna");
    const finger = await json(
      await app.request(`/.well-known/webfinger?resource=acct:anna@${HOST}`),
    );
    const self = (finger.links as { rel: string; href: string }[]).find((l) => l.rel === "self");
    const actorPath = new URL(self?.href ?? "").pathname;
    const { planId } = await createPlanViaUi(anna, { visibility: "followers" });

    const hidden = await anna.hiddenFields("/account");
    const off = await anna.postForm("/account/profile/off", { _csrf: hidden._csrf ?? "" });
    expect(off.headers.get("location")).toBe("/account?profileOff=1#profile");
    expect(await (await anna.get("/account?profileOff=1")).text()).toContain(
      escaped(en("profile.turnedOff", { count: 1 })),
    );

    const gone = await app.request(actorPath, { headers: AP });
    expect(gone.status).toBe(410);
    // ActivityPub clients learn it is gone for good (a Tombstone), not just a missing page.
    expect(gone.headers.get("content-type")).toContain("application/activity+json");
    expect((await json(gone)).type).toBe("Tombstone");
    expect((await app.request(actorPath)).status).toBe(410);
    expect((await app.request("/@anna")).status).toBe(404);
    expect((await app.request(`/.well-known/webfinger?resource=acct:anna@${HOST}`)).status).toBe(
      404,
    );
    const event = await json(await app.request(`/p/${planId}`, { headers: AP }));
    expect(event.attributedTo).toBe(`https://${HOST}/actors/instance`);
    // The handle cannot be taken again.
    expect((await turnOn(anna, "anna")).status).toBe(422);
  });
});

describe("public plans with Nearby off (decision I59)", () => {
  it("are offered once a profile shares them, saying so without Nearby", async () => {
    const { app, anna } = await setup({ NEARBY_ENABLED: "false" });
    expect(await (await anna.get("/new")).text()).not.toContain('value="public"');
    await turnOn(anna, "anna");
    const form = await (await anna.get("/new")).text();
    expect(form).toContain(
      escaped(en("form.visibilityPublicProfile", { handle: `@anna@${HOST}` })),
    );
    const privacy = (await (await app.request("/privacy")).text()).replaceAll("&#39;", "'");
    expect(privacy).toContain(en("privacy.publicPlansProfile"));
    expect(privacy).not.toContain(en("privacy.publicPlans"));
  });
});

describe("deleting the account (spec 3.7)", () => {
  it("lists the fediverse profile among what goes, and retires it", async () => {
    const { app, anna } = await setup();
    expect(await (await anna.get("/account/delete")).text()).not.toContain(
      escaped(en("account.deleteProfile", { handle: `@anna@${HOST}` })),
    );
    await turnOn(anna, "anna");
    const page = await (await anna.get("/account/delete")).text();
    expect(page).toContain(escaped(en("account.deleteProfile", { handle: `@anna@${HOST}` })));
    const hidden = await anna.hiddenFields("/account/delete");
    await anna.postForm("/account/delete", { _csrf: hidden._csrf ?? "" });
    expect((await app.request("/@anna")).status).toBe(404);
  });
});

describe("privacy notice and export", () => {
  it("say what a profile shows, and the account export holds its handle", async () => {
    const { app, anna } = await setup();
    const privacy = (await (await app.request("/privacy")).text()).replaceAll("&#39;", "'");
    expect(privacy).toContain(en("privacy.profiles"));
    await turnOn(anna, "anna");
    const { strFromU8, unzipSync } = await import("fflate");
    const files = unzipSync(
      new Uint8Array(await (await anna.get("/account/export.zip")).arrayBuffer()),
    );
    const data = JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array())) as {
      version: number;
      account: { fediverseHandle: string | null };
    };
    expect(data.version).toBe(7);
    expect(data.account.fediverseHandle).toBe("anna");
  });
});
