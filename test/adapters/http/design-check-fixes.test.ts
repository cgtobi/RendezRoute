// The design check of the 0.9 pages (decision D53, step 13c2): the visibility label for followers
// plans, the profile notice inside its section, the Mastodon line, the warnings and login links.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { FakeOidcServer } from "../../fakes/oidc-server.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, editForm, respondViaUi } from "../../support/plans.ts";

const en = translator("en");

async function setup(env: Record<string, string> = {}) {
  const oidc = new FakeOidcServer();
  const test = await createTestApp({ env: { ...oidc.env(), ...env }, oidc });
  const anna = new TestClient(test.app);
  const started = await anna.get("/login/oidc");
  const callback = oidc.approve(new URL(started.headers.get("location") ?? ""), {
    sub: "anna",
    name: "Anna Müller",
  });
  await anna.get(`${callback.pathname}${callback.search}`);
  return { ...test, anna, stranger: new TestClient(test.app) };
}

async function turnOnProfile(anna: TestClient) {
  const hidden = await anna.hiddenFields("/account");
  return anna.postForm("/account/profile", { _csrf: hidden._csrf ?? "", handle: "anna" });
}

const MASTODON = escaped(en("plan.fediverseJoin"));
const MASTODON_LOGIN = escaped(en("plan.fediverseJoinLogin"));

describe("the visibility label on the plan page", () => {
  it("names Followers and Public, and nothing for link-only", async () => {
    const { anna, stranger } = await setup();
    await turnOnProfile(anna);
    const followers = await createPlanViaUi(anna, { visibility: "followers" });
    const open = await createPlanViaUi(anna, { visibility: "public" });
    const link = await createPlanViaUi(anna, { visibility: "link" });
    const label = (name: string, icon: string) =>
      `<span class="plan-visibility"><span class="icon ${icon}" aria-hidden="true"></span>${escaped(name)}</span>`;
    const body = async (id: string) => (await stranger.get(`/p/${id}`)).text();
    expect(await body(followers.planId)).toContain(label(en("plan.followers"), "icon-users"));
    expect(await body(open.planId)).toContain(label(en("plan.public"), "icon-globe"));
    expect(await body(link.planId)).not.toContain("plan-visibility");
  });
});

describe("the profile notice on the account page", () => {
  const sectionOf = (html: string) => {
    const section = html.slice(html.indexOf('<section id="profile">'));
    return section.slice(0, section.indexOf("</section>"));
  };

  it("sits inside the profile section, under its heading, after turning on", async () => {
    const { anna } = await setup();
    const hidden = await anna.hiddenFields("/account");
    const response = await anna.postForm("/account/profile", {
      _csrf: hidden._csrf ?? "",
      handle: "anna",
    });
    const on = await (await anna.get(response.headers.get("location") ?? "/account")).text();
    expect(sectionOf(on)).toContain(escaped(en("profile.turnedOn")));
  });

  it("sits inside the profile section after turning off, through the real route", async () => {
    const { anna } = await setup();
    await turnOnProfile(anna);
    const hidden = await anna.hiddenFields("/account");
    const response = await anna.postForm("/account/profile/off", { _csrf: hidden._csrf ?? "" });
    expect(response.status).toBe(303);
    const off = await (await anna.get(response.headers.get("location") ?? "/account")).text();
    expect(sectionOf(off)).toContain(escaped(en("profile.turnedOff", { count: 0 })));
  });
});

describe("the Mastodon line on plan pages (spec 7 Client compatibility)", () => {
  it("is shown for followers and public plans shared by a profile", async () => {
    const { anna, stranger } = await setup();
    await turnOnProfile(anna);
    for (const visibility of ["followers", "public"] as const) {
      const { planId } = await createPlanViaUi(anna, { visibility });
      const html = await (await stranger.get(`/p/${planId}`)).text();
      expect(html).toContain(MASTODON);
      expect(html).not.toContain(MASTODON_LOGIN);
    }
    const { planId } = await createPlanViaUi(anna, { visibility: "link" });
    expect(await (await stranger.get(`/p/${planId}`)).text()).not.toContain(MASTODON);
  });

  it("mentions the fediverse login only where it is configured", async () => {
    const { anna, stranger } = await setup({ FEDIVERSE_LOGIN: "true" });
    await turnOnProfile(anna);
    const { planId } = await createPlanViaUi(anna, { visibility: "public" });
    const html = await (await stranger.get(`/p/${planId}`)).text();
    expect(html).toContain(MASTODON_LOGIN);
    expect(html).not.toContain(MASTODON);
  });

  it("is absent while federation is off", async () => {
    const { anna, stranger } = await setup({ FEDERATION_ENABLED: "false" });
    const { planId } = await createPlanViaUi(anna, { visibility: "public" });
    const html = await (await stranger.get(`/p/${planId}`)).text();
    expect(html).not.toContain(MASTODON);
    expect(html).not.toContain(MASTODON_LOGIN);
  });

  it("is absent when no profile shares the plan", async () => {
    const { anna, stranger } = await setup();
    const { planId } = await createPlanViaUi(anna, { visibility: "public" });
    const html = await (await stranger.get(`/p/${planId}`)).text();
    expect(html).not.toContain(MASTODON);
  });

  it("is absent for an anonymous poster's public plan", async () => {
    const test = await createTestApp({ env: { PUBLIC_REQUIRES_LOGIN: "false" } });
    const poster = new TestClient(test.app);
    const { planId } = await createPlanViaUi(poster, { visibility: "public" });
    const html = await (await new TestClient(test.app).get(`/p/${planId}`)).text();
    expect(html).not.toContain(MASTODON);
  });

  it("is absent once the owner's profile is retired", async () => {
    const { anna, stranger } = await setup();
    await turnOnProfile(anna);
    const { planId } = await createPlanViaUi(anna, { visibility: "followers" });
    expect(await (await stranger.get(`/p/${planId}`)).text()).toContain(MASTODON);
    const hidden = await anna.hiddenFields("/account");
    await anna.postForm("/account/profile/off", { _csrf: hidden._csrf ?? "" });
    expect(await (await stranger.get(`/p/${planId}`)).text()).not.toContain(MASTODON);
  });

  it("is absent once narrowing a public plan to followers withdrew it from the fediverse", async () => {
    const { anna, stranger, runJobs } = await setup();
    await turnOnProfile(anna);
    const { planId } = await createPlanViaUi(anna, { visibility: "public" });
    expect(await (await stranger.get(`/p/${planId}`)).text()).toContain(MASTODON);
    await anna.postForm(`/p/${planId}/host`, {
      ...(await editForm(anna, planId)),
      visibility: "followers",
    });
    await runJobs();
    const html = await (await stranger.get(`/p/${planId}`)).text();
    expect(html).toContain(escaped(en("plan.followers")));
    expect(html).not.toContain(MASTODON);
  });

  it("stays on a plan still shared after an edit that keeps its audience", async () => {
    const { anna, stranger, runJobs } = await setup();
    await turnOnProfile(anna);
    const { planId } = await createPlanViaUi(anna, { visibility: "followers" });
    await anna.postForm(`/p/${planId}/host`, {
      ...(await editForm(anna, planId)),
      title: "Renamed run",
    });
    await runJobs();
    expect(await (await stranger.get(`/p/${planId}`)).text()).toContain(MASTODON);
  });

  it("is absent where nobody can join: a cancelled plan", async () => {
    const { anna, stranger } = await setup();
    await turnOnProfile(anna);
    for (const visibility of ["followers", "public"] as const) {
      const { planId } = await createPlanViaUi(anna, { visibility });
      const host = `/p/${planId}/host`;
      await anna.postForm(`${host}/cancel`, await anna.hiddenFields(host));
      const html = await (await stranger.get(`/p/${planId}`)).text();
      expect(html).toContain(escaped(en("respond.closed")));
      expect(html).not.toContain(MASTODON);
    }
  });

  it("is absent where nobody can join: a closed plan", async () => {
    const { anna, stranger, clock } = await setup();
    await turnOnProfile(anna);
    const { planId } = await createPlanViaUi(anna, { visibility: "public" });
    expect(await (await stranger.get(`/p/${planId}`)).text()).toContain(MASTODON);
    clock.advance({ hours: 24 * 7 });
    const html = await (await stranger.get(`/p/${planId}`)).text();
    expect(html).toContain(escaped(en("respond.closed")));
    expect(html).not.toContain(MASTODON);
  });

  it("is not shown to the host or to participants", async () => {
    const { anna, stranger } = await setup();
    await turnOnProfile(anna);
    const { planId } = await createPlanViaUi(anna, { visibility: "public" });
    expect(await (await anna.get(`/p/${planId}`)).text()).not.toContain(MASTODON);
    await respondViaUi(stranger, planId, "Ben", "joined");
    expect(await (await stranger.get(`/p/${planId}`)).text()).not.toContain(MASTODON);
  });
});

describe("the plan form's followers option", () => {
  it("sends a logged-in poster without a profile to the account page, a visitor to log in", async () => {
    const { anna, stranger } = await setup();
    const own = await (await anna.get("/new")).text();
    expect(own).toContain(`<a href="/account#profile">${escaped(en("form.followersSetUp"))}</a>`);
    const visitor = await (await stranger.get("/new")).text();
    expect(visitor).toContain(
      `<a href="/account#profile">${escaped(en("form.followersLogInSetUp"))}</a>`,
    );
    expect(visitor).not.toContain(`>${escaped(en("form.followersSetUp"))}</a>`);
  });
});
