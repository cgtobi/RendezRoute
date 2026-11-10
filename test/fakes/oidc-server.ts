// A fake OpenID Connect provider for tests (plan v1.0 step 4a): discovery, a JWK Set, and a token
// endpoint that checks the client, the exact redirect URI and the PKCE verifier, and signs ID tokens
// with ES256. `approve` plays the person logging in. Times use the real clock, as openid-client does.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { TrustedFetch } from "../../src/adapters/out/http/trusted-fetch.ts";

export interface FakeOidcUser {
  sub: string;
  name?: string;
  preferred_username?: string;
}

/** Ways to make the provider misbehave, for the account-takeover tests (spec 3.11). */
export interface IdTokenTampering {
  nonce?: string;
  iss?: string;
  aud?: string;
  expiresInSeconds?: number;
  /** Signed with a key that is not in the JWK Set. */
  foreignKey?: boolean;
}

interface Grant {
  user: FakeOidcUser;
  clientId: string;
  redirectUri: string;
  codeChallenge: string | null;
  nonce: string | null;
  tampering: IdTokenTampering;
}

const base64url = (bytes: Buffer | string) => Buffer.from(bytes).toString("base64url");

export class FakeOidcServer {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** Every request the app made, for assertions. */
  readonly requests: { method: string; url: string; body: string }[] = [];
  /** Every token issued, for checking they are kept nowhere. */
  readonly issued: { accessToken: string; idToken: string }[] = [];
  readonly #key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  readonly #foreign = generateKeyPairSync("ec", { namedCurve: "P-256" });
  readonly #grants = new Map<string, Grant>();
  /** Answer discovery with an error, as an unreachable provider would. */
  down = false;

  constructor({
    issuer = "https://id.example.org/realms/club",
    clientId = "rendezroute",
    clientSecret = "client-secret-0123456789",
    redirectUri = "https://runs.example.org/login/oidc/callback",
  } = {}) {
    this.issuer = issuer;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  /** The configuration that points the app at this provider. */
  env(): Record<string, string> {
    return {
      OIDC_ISSUER: this.issuer,
      OIDC_CLIENT_ID: this.clientId,
      OIDC_CLIENT_SECRET: this.clientSecret,
      OIDC_NAME: "Club login",
    };
  }

  /** The person logs in and agrees: the provider sends the browser back with a code. */
  approve(authorizationUrl: URL | string, user: FakeOidcUser, tampering: IdTokenTampering = {}) {
    const url = new URL(authorizationUrl);
    if (!url.href.startsWith(`${this.issuer}/auth`))
      throw new Error(`not our endpoint: ${url.href}`);
    const param = (name: string) => url.searchParams.get(name);
    const code = base64url(randomBytes(24));
    this.#grants.set(code, {
      user,
      clientId: param("client_id") ?? "",
      redirectUri: param("redirect_uri") ?? "",
      codeChallenge: param("code_challenge_method") === "S256" ? param("code_challenge") : null,
      nonce: param("nonce"),
      tampering,
    });
    const callback = new URL(param("redirect_uri") ?? "");
    callback.searchParams.set("code", code);
    const state = param("state");
    if (state !== null) callback.searchParams.set("state", state);
    callback.searchParams.set("iss", this.issuer);
    return callback;
  }

  /** The person declines: the provider sends the browser back with an error. */
  deny(authorizationUrl: URL | string) {
    const url = new URL(authorizationUrl);
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    callback.searchParams.set("iss", this.issuer);
    return callback;
  }

  readonly fetch: TrustedFetch = async (url, init) => {
    const body =
      typeof init.body === "string"
        ? init.body
        : init.body instanceof URLSearchParams
          ? init.body.toString()
          : init.body === null || init.body === undefined
            ? ""
            : Buffer.from(init.body as Uint8Array).toString("utf8");
    const method = init.method ?? "GET";
    this.requests.push({ method, url, body });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url === `${this.issuer}/.well-known/openid-configuration`) {
      if (this.down) return new Response("unavailable", { status: 503 });
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/auth`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["ES256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url === `${this.issuer}/jwks`) {
      const jwk = this.#key.publicKey.export({ format: "jwk" });
      return json(200, { keys: [{ ...jwk, kid: "key-1", alg: "ES256", use: "sig" }] });
    }
    if (url === `${this.issuer}/token` && method === "POST") return this.#token(body, init);
    return new Response("not found", { status: 404 });
  };

  #token(body: string, init: Parameters<TrustedFetch>[1]): Response {
    const form = new URLSearchParams(body);
    const error = (code: string) =>
      new Response(JSON.stringify({ error: code }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    const headers = new Headers(init.headers as Record<string, string>);
    const basic = headers.get("authorization");
    const [basicId, basicSecret] =
      basic?.startsWith("Basic ") === true
        ? Buffer.from(basic.slice(6), "base64").toString("utf8").split(":").map(decodeURIComponent)
        : [];
    const clientId = form.get("client_id") ?? basicId;
    const clientSecret = form.get("client_secret") ?? basicSecret;
    if (clientId !== this.clientId || clientSecret !== this.clientSecret) {
      return error("invalid_client");
    }
    const code = form.get("code") ?? "";
    const grant = this.#grants.get(code);
    // A code works once.
    this.#grants.delete(code);
    if (form.get("grant_type") !== "authorization_code" || grant === undefined) {
      return error("invalid_grant");
    }
    if (grant.clientId !== clientId) return error("invalid_grant");
    // Exact redirect URI matching (RFC 6749 4.1.3), against both registration and request.
    const redirectUri = form.get("redirect_uri");
    if (redirectUri !== this.redirectUri || redirectUri !== grant.redirectUri) {
      return error("invalid_grant");
    }
    // PKCE (RFC 7636): the verifier must hash to the challenge sent at the start.
    const verifier = form.get("code_verifier");
    if (grant.codeChallenge === null || verifier === null) return error("invalid_grant");
    if (base64url(createHash("sha256").update(verifier).digest()) !== grant.codeChallenge) {
      return error("invalid_grant");
    }
    const now = Math.floor(Date.now() / 1000);
    const { tampering } = grant;
    const claims = {
      iss: tampering.iss ?? this.issuer,
      sub: grant.user.sub,
      aud: tampering.aud ?? this.clientId,
      iat: now,
      exp: now + (tampering.expiresInSeconds ?? 300),
      ...(grant.nonce === null ? {} : { nonce: tampering.nonce ?? grant.nonce }),
      ...(grant.user.name === undefined ? {} : { name: grant.user.name }),
      ...(grant.user.preferred_username === undefined
        ? {}
        : { preferred_username: grant.user.preferred_username }),
    };
    const key = tampering.foreignKey === true ? this.#foreign.privateKey : this.#key.privateKey;
    const signingInput = `${base64url(JSON.stringify({ alg: "ES256", kid: "key-1", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
    const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
    const accessToken = `access-${base64url(randomBytes(16))}`;
    const idToken = `${signingInput}.${base64url(signature)}`;
    this.issued.push({ accessToken, idToken });
    return new Response(
      JSON.stringify({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      }),
      { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  }
}
