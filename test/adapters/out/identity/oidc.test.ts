// The OIDC adapter against a fake provider (spec 7 Identity, 3.11 Account takeover; decision D23).
import { describe, expect, it } from "vite-plus/test";
import { createOidcProvider } from "../../../../src/adapters/out/identity/oidc.ts";
import { FakeOidcServer, type IdTokenTampering } from "../../../fakes/oidc-server.ts";

function setup(options: { clientSecret?: string | undefined } = {}) {
  const server = new FakeOidcServer();
  const provider = createOidcProvider({
    issuer: new URL(server.issuer),
    clientId: server.clientId,
    clientSecret: "clientSecret" in options ? options.clientSecret : server.clientSecret,
    redirectUri: new URL(server.redirectUri),
    fetch: server.fetch,
    allowHttp: false,
  });
  return { server, provider };
}

const anna = { sub: "user-123", name: "Anna Example", preferred_username: "anna" };

describe("OIDC login (spec 7 Identity)", () => {
  it("sends the browser to the provider with PKCE, state, nonce and the exact redirect URI", async () => {
    const { provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin();
    const params = authorizationUrl.searchParams;
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://id.example.org/realms/club/auth",
    );
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("rendezroute");
    expect(params.get("redirect_uri")).toBe("https://runs.example.org/login/oidc/callback");
    expect(params.get("scope")).toBe("openid profile");
    expect(params.get("state")).toBe(secrets.state);
    expect(params.get("nonce")).toBe(secrets.nonce);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The verifier never leaves the server until the token request.
    expect(authorizationUrl.href).not.toContain(secrets.codeVerifier);
    const again = await provider.startLogin();
    expect(again.secrets.state).not.toBe(secrets.state);
    expect(again.secrets.codeVerifier).not.toBe(secrets.codeVerifier);
  });

  it("returns the subject, issuer included, and the names the provider gives", async () => {
    const { server, provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin();
    const result = await provider.finishLogin(server.approve(authorizationUrl, anna), secrets);
    expect(result).toEqual({
      ok: true,
      account: {
        subject: "https://id.example.org/realms/club user-123",
        names: ["Anna Example", "anna"],
      },
    });
    const token = server.requests.find((r) => r.url.endsWith("/token"));
    expect(new URLSearchParams(token?.body).get("code_verifier")).toBe(secrets.codeVerifier);
  });

  it("works as a public client without a secret, relying on PKCE", async () => {
    const { server, provider } = setup({ clientSecret: undefined });
    const { authorizationUrl, secrets } = await provider.startLogin();
    const callback = server.approve(authorizationUrl, anna);
    // The fake insists on its secret, so the token request is refused: no secret was sent.
    expect(await provider.finishLogin(callback, secrets)).toEqual({ ok: false });
    const token = server.requests.find((r) => r.url.endsWith("/token"));
    expect(new URLSearchParams(token?.body).get("client_secret")).toBeNull();
  });
});

describe("OIDC account takeover protections (spec 3.11)", () => {
  async function attempt(
    change: (login: Awaited<ReturnType<typeof start>>) => {
      callback: URL;
      secrets: typeof login.secrets;
    },
  ) {
    const login = await start();
    const { callback, secrets } = change(login);
    return login.provider.finishLogin(callback, secrets);
  }
  async function start(tampering: IdTokenTampering = {}) {
    const { server, provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin();
    return { server, provider, authorizationUrl, secrets, tampering };
  }

  it("refuses a callback whose state is missing or belongs to another login", async () => {
    const missing = await attempt(({ server, authorizationUrl, secrets }) => {
      const callback = server.approve(authorizationUrl, anna);
      callback.searchParams.delete("state");
      return { callback, secrets };
    });
    expect(missing).toEqual({ ok: false });
    const other = await attempt(({ server, authorizationUrl, secrets }) => ({
      callback: server.approve(authorizationUrl, anna),
      secrets: { ...secrets, state: "another-login-state" },
    }));
    expect(other).toEqual({ ok: false });
  });

  it("refuses a code from another login (wrong or missing PKCE verifier)", async () => {
    const { server, provider } = setup();
    const victim = await provider.startLogin();
    const attacker = await provider.startLogin();
    // The attacker's code, injected into the victim's login: the verifiers do not match.
    const injected = server.approve(attacker.authorizationUrl, { sub: "attacker" });
    injected.searchParams.set("state", victim.secrets.state);
    expect(await provider.finishLogin(injected, victim.secrets)).toEqual({ ok: false });
    const login = await provider.startLogin();
    const callback = server.approve(login.authorizationUrl, anna);
    expect(await provider.finishLogin(callback, { ...login.secrets, codeVerifier: "" })).toEqual({
      ok: false,
    });
  });

  it("refuses a code used twice", async () => {
    const { server, provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin();
    const callback = server.approve(authorizationUrl, anna);
    expect((await provider.finishLogin(callback, secrets)).ok).toBe(true);
    expect(await provider.finishLogin(callback, secrets)).toEqual({ ok: false });
  });

  it("refuses ID tokens with the wrong nonce, issuer, audience, expiry or signature", async () => {
    const tamperings: IdTokenTampering[] = [
      { nonce: "replayed-nonce" },
      { iss: "https://evil.example" },
      { aud: "another-client" },
      { expiresInSeconds: -600 },
      { foreignKey: true },
    ];
    const results = [];
    for (const tampering of tamperings) {
      const { server, provider } = setup();
      const { authorizationUrl, secrets } = await provider.startLogin();
      const callback = server.approve(authorizationUrl, anna, tampering);
      results.push({ tampering, result: await provider.finishLogin(callback, secrets) });
    }
    expect(results).toEqual(tamperings.map((tampering) => ({ tampering, result: { ok: false } })));
  });

  it("refuses a callback that claims another issuer (RFC 9207) or carries an error", async () => {
    const wrongIssuer = await attempt(({ server, authorizationUrl, secrets }) => {
      const callback = server.approve(authorizationUrl, anna);
      callback.searchParams.set("iss", "https://evil.example");
      return { callback, secrets };
    });
    expect(wrongIssuer).toEqual({ ok: false });
    const denied = await attempt(({ server, authorizationUrl, secrets }) => ({
      callback: server.deny(authorizationUrl),
      secrets,
    }));
    expect(denied).toEqual({ ok: false });
  });

  it("answers the token request with the configured redirect URI, whatever host the callback came to", async () => {
    const { server, provider } = setup();
    const { authorizationUrl, secrets } = await provider.startLogin();
    const callback = server.approve(authorizationUrl, anna);
    const elsewhere = new URL(`https://evil.example/login/oidc/callback${callback.search}`);
    expect((await provider.finishLogin(elsewhere, secrets)).ok).toBe(true);
    const token = server.requests.find((r) => r.url.endsWith("/token"));
    expect(new URLSearchParams(token?.body).get("redirect_uri")).toBe(
      "https://runs.example.org/login/oidc/callback",
    );
  });

  it("fails when the provider has another redirect URI registered (exact matching)", async () => {
    const server = new FakeOidcServer({ redirectUri: "https://runs.example.org/other/callback" });
    const provider = createOidcProvider({
      issuer: new URL(server.issuer),
      clientId: server.clientId,
      clientSecret: server.clientSecret,
      redirectUri: new URL("https://runs.example.org/login/oidc/callback"),
      fetch: server.fetch,
      allowHttp: false,
    });
    const { authorizationUrl, secrets } = await provider.startLogin();
    const callback = server.approve(authorizationUrl, anna);
    expect(await provider.finishLogin(callback, secrets)).toEqual({ ok: false });
  });

  it("fails to start while the provider cannot be reached, and tries again later", async () => {
    const { server, provider } = setup();
    server.down = true;
    await expect(provider.startLogin()).rejects.toThrow(/unexpected HTTP response status/);
    server.down = false;
    expect((await provider.startLogin()).authorizationUrl).toBeInstanceOf(URL);
  });
});
