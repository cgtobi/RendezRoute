// Accounts (spec 7 Identity, 3.11 Account takeover; plan v1.0 step 4a).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type AccountDeps,
  finishLogin,
  logOut,
  renameAccount,
  startLogin,
  viewAccount,
} from "../../src/application/accounts.ts";
import { createPlan } from "../../src/application/plans.ts";
import { mayCreatePlans } from "../../src/application/posting-rules.ts";
import type { ProviderAccount } from "../../src/application/ports.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakeIdentityProvider } from "../fakes/identity-provider.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: AccountDeps;
let clock: FakeClock;
let provider: FakeIdentityProvider;
let fediverseProvider: FakeIdentityProvider;
let repositories: ReturnType<typeof createFakeRepositories>;
const anna: ProviderAccount = {
  subject: "https://id.example.org user-1",
  names: ["Anna Example", "anna"],
};

beforeEach(() => {
  clock = new FakeClock(fixtureNow);
  provider = new FakeIdentityProvider();
  fediverseProvider = new FakeIdentityProvider();
  repositories = createFakeRepositories();
  deps = {
    ...repositories,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    identityLookup: { hash: (value) => `hmac(${value})` },
    identityProviders: { oidc: provider, fediverse: fediverseProvider },
    fediverse: { servers: undefined, allowInsecure: false },
  };
});

/** Starts a login; returns what the browser carries: the provider's URL and the login cookie. */
async function start() {
  const started = await startLogin(deps, { provider: "oidc" });
  if (started.kind !== "redirect") throw new Error(`login not started: ${started.kind}`);
  return started;
}

/** A whole login as the browser does it; returns the device token afterwards. */
async function logIn(account = anna, deviceToken?: string) {
  const { authorizationUrl, state } = await start();
  const result = await finishLogin(deps, {
    provider: "oidc",
    callback: provider.approve(authorizationUrl, account),
    cookieState: state,
    deviceToken,
  });
  if (result.kind !== "logged_in") throw new Error(`login failed: ${result.kind}`);
  return result.newDeviceToken ?? deviceToken;
}

describe("logging in (spec 7 Identity)", () => {
  it("creates the account on first login, with the provider's name, and links the device", async () => {
    const deviceToken = await logIn();
    expect(await viewAccount(deps, { deviceToken })).toEqual({
      kind: "account",
      provider: "oidc",
      displayName: "Anna Example",
    });
    expect(repositories.identities.all()).toEqual([
      {
        id: expect.any(String),
        provider: "oidc",
        subject: anna.subject,
        handle: undefined,
        displayName: "Anna Example",
        createdAt: fixtureNow,
        lastActiveAt: fixtureNow,
      },
    ]);
  });

  it("finds the same account again by its subject, on any device, keeping the chosen name", async () => {
    const first = await logIn();
    await renameAccount(deps, { deviceToken: first, displayName: "Anna R." });
    clock.set("2026-06-02T08:00:00Z");
    const second = await logIn({ subject: anna.subject, names: ["Someone else"] });
    expect(second).not.toBe(first);
    expect(repositories.identities.all()).toHaveLength(1);
    expect(repositories.identities.all()[0]?.lastActiveAt).toEqual(
      new Date("2026-06-02T08:00:00Z"),
    );
    expect(await viewAccount(deps, { deviceToken: second })).toMatchObject({
      displayName: "Anna R.",
    });
  });

  it("gives the device a new cookie token at login, keeping its links (session fixation)", async () => {
    const created = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: "nonce-0000000000000009",
      deviceToken: undefined,
    });
    if (created.kind !== "created") throw new Error("setup failed");
    const before = created.newDeviceToken;
    const after = await logIn(anna, before);
    expect(after).not.toBe(before);
    expect(await viewAccount(deps, { deviceToken: before })).toEqual({ kind: "logged_out" });
    expect(await viewAccount(deps, { deviceToken: after })).toMatchObject({ kind: "account" });
    const device = await deps.devices.findByTokenHash(deps.tokens.hash(after ?? ""));
    expect(
      await deps.devices.hasLink(device?.id ?? "", { role: "host", planId: created.planId }),
    ).toBe(true);
  });

  it("uses one account when the same person's first logins finish at the same time", async () => {
    const first = await start();
    const second = await start();
    const create = deps.identities.create.bind(deps.identities);
    // The other browser's login creates the account between this one's lookup and its insert.
    deps.identities.create = async (identity, hash) => {
      deps.identities.create = create;
      await create({ ...identity, id: "winner" }, hash);
      throw new Error("UNIQUE constraint failed: identities.provider, identities.subject_hmac");
    };
    const finish = (login: typeof first) =>
      finishLogin(deps, {
        provider: "oidc",
        callback: provider.approve(login.authorizationUrl, anna),
        cookieState: login.state,
        deviceToken: undefined,
      });
    expect((await finish(first)).kind).toBe("logged_in");
    expect((await finish(second)).kind).toBe("logged_in");
    expect(repositories.identities.all().map((identity) => identity.id)).toEqual(["winner"]);
  });

  it("uses the device it already has", async () => {
    const created = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: "nonce-0000000000000001",
      deviceToken: undefined,
    });
    if (created.kind !== "created") throw new Error("setup failed");
    const deviceToken = created.newDeviceToken;
    await logIn(anna, deviceToken);
    expect(repositories.devices.all()).toHaveLength(1);
  });

  it("leaves no name when the provider gives no usable one", async () => {
    const deviceToken = await logIn({ subject: "x", names: [undefined, "a\u0000b"] });
    expect(await viewAccount(deps, { deviceToken })).toMatchObject({ displayName: undefined });
  });

  it("says when the provider cannot be reached, or is not configured", async () => {
    provider.unavailable = true;
    expect(await startLogin(deps, { provider: "oidc" })).toEqual({ kind: "unavailable" });
    deps.identityProviders = { oidc: provider };
    expect(await startLogin(deps, { provider: "fediverse" })).toEqual({ kind: "not_found" });
  });
});

describe("login protections (spec 3.11 Account takeover)", () => {
  it("refuse a callback in a browser that did not start the login (login CSRF)", async () => {
    const { authorizationUrl, state } = await start();
    const callback = provider.approve(authorizationUrl, anna);
    for (const cookieState of [undefined, "another-browsers-state"]) {
      expect(
        await finishLogin(deps, {
          provider: "oidc",
          callback,
          cookieState,
          deviceToken: undefined,
        }),
      ).toEqual({ kind: "failed" });
    }
    // The real browser can still finish it.
    const finished = await finishLogin(deps, {
      provider: "oidc",
      callback,
      cookieState: state,
      deviceToken: undefined,
    });
    expect(finished.kind).toBe("logged_in");
  });

  it("compare the callback's state with the browser's themselves, whatever the provider checks", async () => {
    provider.checksState = false;
    const { authorizationUrl, state } = await start();
    const callback = provider.approve(authorizationUrl, anna);
    callback.searchParams.set("state", "state-of-another-login");
    expect(
      await finishLogin(deps, {
        provider: "oidc",
        callback,
        cookieState: state,
        deviceToken: undefined,
      }),
    ).toEqual({ kind: "failed" });
  });

  it("refuse a login finished twice, or after ten minutes", async () => {
    const { authorizationUrl, state } = await start();
    const callback = provider.approve(authorizationUrl, anna);
    const finish = () =>
      finishLogin(deps, { provider: "oidc", callback, cookieState: state, deviceToken: undefined });
    expect((await finish()).kind).toBe("logged_in");
    expect(await finish()).toEqual({ kind: "failed" });

    const late = await start();
    clock.set(new Date(fixtureNow.getTime() + 10 * 60_000));
    expect(
      await finishLogin(deps, {
        provider: "oidc",
        callback: provider.approve(late.authorizationUrl, anna),
        cookieState: late.state,
        deviceToken: undefined,
      }),
    ).toEqual({ kind: "failed" });
  });

  it("refuse what the provider refuses, creating no account and no device", async () => {
    const { authorizationUrl, state } = await start();
    const callback = provider.approve(authorizationUrl, anna);
    callback.searchParams.set("code", "forged");
    expect(
      await finishLogin(deps, {
        provider: "oidc",
        callback,
        cookieState: state,
        deviceToken: undefined,
      }),
    ).toEqual({ kind: "failed" });
    expect(repositories.identities.all()).toEqual([]);
    expect(repositories.devices.all()).toEqual([]);
  });

  it("find accounts by a keyed hash of provider and subject", async () => {
    await logIn();
    expect(
      await deps.identities.findBySubjectHash("oidc", `hmac(oidc:${anna.subject})`),
    ).toBeDefined();
  });

  it("drop logins left unfinished when the next one starts", async () => {
    const first = await start();
    clock.set(new Date(fixtureNow.getTime() + 11 * 60_000));
    const second = await start();
    expect(await deps.pendingLogins.take(deps.tokens.hash(first.state))).toBeUndefined();
    expect(await deps.pendingLogins.take(deps.tokens.hash(second.state))).toBeDefined();
  });
});

describe("fediverse logins (spec 7 Identity, decision D24)", () => {
  const login = async (server: string, account: ProviderAccount) => {
    const started = await startLogin(deps, { provider: "fediverse", server });
    if (started.kind !== "redirect") throw new Error(`not started: ${started.kind}`);
    const finished = await finishLogin(deps, {
      provider: "fediverse",
      callback: fediverseProvider.approve(started.authorizationUrl, account),
      cookieState: started.state,
      deviceToken: undefined,
    });
    if (finished.kind !== "logged_in") throw new Error("login failed");
    return finished.newDeviceToken;
  };

  it("start at the server as typed, made an origin, and only at public servers", async () => {
    expect(
      (await startLogin(deps, { provider: "fediverse", server: "@anna@Social.Example" })).kind,
    ).toBe("redirect");
    expect(fediverseProvider.servers).toEqual(["https://social.example"]);
    expect(await startLogin(deps, { provider: "fediverse", server: "10.0.0.1" })).toEqual({
      kind: "invalid",
      error: "server_invalid",
    });
    expect(await startLogin(deps, { provider: "fediverse", server: undefined })).toEqual({
      kind: "invalid",
      error: "server_invalid",
    });
  });

  it("start only at listed servers when FEDIVERSE_LOGIN_SERVERS has a list", async () => {
    deps.fediverse = { servers: ["club.example"], allowInsecure: false };
    expect(await startLogin(deps, { provider: "fediverse", server: "mastodon.social" })).toEqual({
      kind: "invalid",
      error: "server_not_allowed",
    });
    expect((await startLogin(deps, { provider: "fediverse", server: "club.example" })).kind).toBe(
      "redirect",
    );
  });

  it("keep the account when it is renamed, with the new handle and the stable subject", async () => {
    const subject = "https://social.example 109";
    await login("social.example", { subject, handle: "@anna@social.example", names: ["Anna"] });
    await login("social.example", { subject, handle: "@anna_r@social.example", names: ["A"] });
    expect(repositories.identities.all()).toEqual([
      expect.objectContaining({
        provider: "fediverse",
        subject,
        handle: "@anna_r@social.example",
        displayName: "Anna",
      }),
    ]);
  });

  it("are other accounts than OIDC ones, even with the same subject", async () => {
    await logIn({ subject: "same", names: [] });
    await login("social.example", { subject: "same", names: [] });
    expect(
      repositories.identities
        .all()
        .map((identity) => identity.provider)
        .sort(),
    ).toEqual(["fediverse", "oidc"]);
  });
});

describe("the account (spec 7 Identity)", () => {
  it("can be renamed, within the display name rules", async () => {
    const deviceToken = await logIn();
    expect(await renameAccount(deps, { deviceToken, displayName: " Anna R. " })).toEqual({
      kind: "renamed",
    });
    expect(await viewAccount(deps, { deviceToken })).toMatchObject({ displayName: "Anna R." });
    expect(await renameAccount(deps, { deviceToken, displayName: "x".repeat(51) })).toEqual({
      kind: "invalid",
      error: "too_long",
    });
    expect(await renameAccount(deps, { deviceToken: undefined, displayName: "x" })).toEqual({
      kind: "logged_out",
    });
  });

  it("logs this device out and keeps the account and the device's own links", async () => {
    const deviceToken = await logIn();
    expect(await logOut(deps, { deviceToken })).toEqual({ kind: "logged_out" });
    expect(await viewAccount(deps, { deviceToken })).toEqual({ kind: "logged_out" });
    expect(repositories.identities.all()).toHaveLength(1);
    expect(repositories.devices.all()).toHaveLength(1);
  });

  it("is not shown to a device that never logged in, which viewing does not create", async () => {
    expect(await viewAccount(deps, { deviceToken: undefined })).toEqual({ kind: "logged_out" });
    expect(await viewAccount(deps, { deviceToken: "unknown" })).toEqual({ kind: "logged_out" });
    expect(repositories.devices.all()).toEqual([]);
  });
});

describe("POSTING_MODE=logged_in (spec 7 Moderation)", () => {
  it("lets only logged-in devices create plans", async () => {
    deps.postingMode = "logged_in";
    expect(await mayCreatePlans(deps, { deviceToken: undefined })).toBe(false);
    const deviceToken = await logIn();
    expect(await mayCreatePlans(deps, { deviceToken })).toBe(true);
    await logOut(deps, { deviceToken });
    expect(await mayCreatePlans(deps, { deviceToken })).toBe(false);
  });
});
