// Fediverse login through the Mastodon API against fake servers (spec 7 Identity, 3.11 Account
// takeover; decisions D23, D24, I50).
import { describe, expect, it } from "vite-plus/test";
import { createFediverseProvider } from "../../../../src/adapters/out/identity/fediverse.ts";
import { createOutboundHttp } from "../../../../src/adapters/out/http/outbound-http.ts";
import type { OutboundHttp } from "../../../../src/application/ports.ts";
import { FakeMastodonServer, fediverse } from "../../../fakes/mastodon-server.ts";

const callbackKey = (server: string) => `key-${new URL(server).hostname.replaceAll(".", "-")}`;
const callbackOf = (host: string) =>
  `https://runs.example.org/login/fediverse/callback/key-${host.replaceAll(".", "-")}`;
const anna = { id: "109", username: "anna", display_name: "Anna Example" };

function setup(http?: OutboundHttp) {
  const server = new FakeMastodonServer();
  const evil = new FakeMastodonServer("https://evil.example");
  const provider = createFediverseProvider({
    http: http ?? fediverse(server, evil),
    callbackUri: (origin) =>
      new URL(`/login/fediverse/callback/${callbackKey(origin)}`, "https://runs.example.org"),
    clientName: "RendezRoute",
    website: new URL("https://runs.example.org/"),
  });
  return { server, evil, provider };
}

const params = (body: string) => new URLSearchParams(body);

describe("fediverse login (spec 7 Identity)", () => {
  it("registers its own app at every login, with the server's own redirect URI and only read:accounts", async () => {
    const { server, provider } = setup();
    const first = await provider.startLogin({ server: server.origin });
    const second = await provider.startLogin({ server: server.origin });
    const registrations = server.requests.filter((r) => r.path === "/api/v1/apps");
    expect(registrations).toHaveLength(2);
    expect(params(registrations[0]?.body ?? "").get("scopes")).toBe("read:accounts");
    expect(params(registrations[0]?.body ?? "").get("redirect_uris")).toBe(
      callbackOf("social.example"),
    );
    expect(first.secrets.client?.id).not.toBe(second.secrets.client?.id);
  });

  it("sends the browser to the server with PKCE, state and the exact redirect URI", async () => {
    const { server, provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin({ server: server.origin });
    const query = authorizationUrl.searchParams;
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://social.example/oauth/authorize",
    );
    expect(query.get("response_type")).toBe("code");
    expect(query.get("client_id")).toBe(secrets.client?.id);
    expect(query.get("redirect_uri")).toBe(callbackOf("social.example"));
    expect(query.get("scope")).toBe("read:accounts");
    expect(query.get("state")).toBe(secrets.state);
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.href).not.toContain(secrets.codeVerifier);
    expect(authorizationUrl.href).not.toContain(secrets.client?.secret ?? "missing");
    expect(secrets.server).toBe("https://social.example");
  });

  it("returns the account by server and stable ID with its handle, and gives the token back", async () => {
    const { server, provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin({ server: server.origin });
    const result = await provider.finishLogin(server.approve(authorizationUrl, anna), secrets);
    expect(result).toEqual({
      ok: true,
      account: {
        subject: "https://social.example 109",
        handle: "@anna@social.example",
        names: ["Anna Example", "anna"],
      },
    });
    expect(server.revoked).toEqual(server.issued);
    const token = server.requests.find((r) => r.path === "/oauth/token");
    expect(params(token?.body ?? "").get("code_verifier")).toBe(secrets.codeVerifier);
    expect(params(token?.body ?? "").get("redirect_uri")).toBe(callbackOf("social.example"));
  });

  it("keeps the subject when the account is renamed", async () => {
    const { server, provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin({ server: server.origin });
    const renamed = { ...anna, username: "anna_r" };
    expect(
      await provider.finishLogin(server.approve(authorizationUrl, renamed), secrets),
    ).toMatchObject({
      ok: true,
      account: { subject: "https://social.example 109", handle: "@anna_r@social.example" },
    });
  });

  it("gives the token back also when the account cannot be read, and refuses odd accounts", async () => {
    const { server, provider } = setup();
    for (const odd of [
      { id: "", username: "anna" },
      { id: "109", username: "anna@evil.example" },
      { id: "109", username: "x".repeat(65) },
    ]) {
      const { authorizationUrl, secrets } = await provider.startLogin({ server: server.origin });
      expect(await provider.finishLogin(server.approve(authorizationUrl, odd), secrets)).toEqual({
        ok: false,
      });
    }
    expect(server.issued).toHaveLength(3);
    expect(server.revoked).toEqual(server.issued);
  });

  it("fails to start when the server cannot be reached or refuses the app", async () => {
    const { server, provider } = setup();
    await expect(provider.startLogin({ server: "https://nowhere.example" })).rejects.toThrow(
      /unreachable/,
    );
    server.down = true;
    await expect(provider.startLogin({ server: server.origin })).rejects.toThrow(/registration/);
    await expect(provider.startLogin({})).rejects.toThrow(/server/);
  });

  it("keeps SSRF protection: a server name resolving to a private address is not contacted", async () => {
    const http = createOutboundHttp({
      userAgent: "test",
      resolve: async () => [{ address: "10.0.0.5", family: 4 }],
    });
    const { provider } = setup(http);
    await expect(provider.startLogin({ server: "https://internal.example" })).rejects.toThrow(
      /forbidden address/,
    );
  });
});

describe("fediverse account takeover protections (spec 3.11)", () => {
  it("refuse a callback with a missing or foreign state, or a declined login", async () => {
    const { server, provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin({ server: server.origin });
    const missing = server.approve(authorizationUrl, anna);
    missing.searchParams.delete("state");
    const foreign = server.approve(authorizationUrl, anna);
    foreign.searchParams.set("state", "another-login");
    const results = [
      await provider.finishLogin(missing, secrets),
      await provider.finishLogin(foreign, secrets),
      await provider.finishLogin(server.deny(authorizationUrl), secrets),
    ];
    expect(results).toEqual([{ ok: false }, { ok: false }, { ok: false }]);
  });

  it("refuse another login's code, a missing PKCE verifier and a code used twice", async () => {
    const { server, provider } = setup();
    const victim = await provider.startLogin({ server: server.origin });
    const attacker = await provider.startLogin({ server: server.origin });
    const injected = server.approve(attacker.authorizationUrl, { id: "666", username: "evil" });
    injected.searchParams.set("state", victim.secrets.state);
    expect(await provider.finishLogin(injected, victim.secrets)).toEqual({ ok: false });

    const noVerifier = await provider.startLogin({ server: server.origin });
    expect(
      await provider.finishLogin(server.approve(noVerifier.authorizationUrl, anna), {
        ...noVerifier.secrets,
        codeVerifier: "",
      }),
    ).toEqual({ ok: false });

    const login = await provider.startLogin({ server: server.origin });
    const callback = server.approve(login.authorizationUrl, anna);
    expect((await provider.finishLogin(callback, login.secrets)).ok).toBe(true);
    expect(await provider.finishLogin(callback, login.secrets)).toEqual({ ok: false });
  });

  it("refuse a code sent to another redirect URI than the login's", async () => {
    const { server, provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin({ server: server.origin });
    const elsewhere = new URL(authorizationUrl);
    elsewhere.searchParams.set("redirect_uri", callbackOf("other.example"));
    expect(await provider.finishLogin(server.approve(elsewhere, anna), secrets)).toEqual({
      ok: false,
    });
    expect(server.requests.filter((r) => r.path === "/oauth/token")).toEqual([]);
  });

  it("never hand an honest server's code to the server the login started at (mix-up)", async () => {
    const { server, evil, provider } = setup();
    // The attacker logs in at the honest server, to learn our client ID there and a PKCE challenge
    // whose verifier their own login holds.
    const attackers = await provider.startLogin({ server: server.origin });
    // Someone starts at the attacker's server, which forwards the browser to the honest server
    // with the attacker's parameters and this login's state.
    const victims = await provider.startLogin({ server: evil.origin });
    const forwarded = new URL(attackers.authorizationUrl);
    forwarded.searchParams.set("state", victims.secrets.state);
    const callback = server.approve(forwarded, anna);
    expect(await provider.finishLogin(callback, victims.secrets)).toEqual({ ok: false });
    expect(evil.requests.filter((r) => r.path === "/oauth/token")).toEqual([]);
  });
});
