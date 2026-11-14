// Fake identity providers for end-to-end tests (plan v1.0 0.7 wrap-up): an OpenID Connect provider
// under /oidc and a Mastodon-API server at the root, both approving every login at once as a fixed
// person. They still check what a real provider checks: the client and its registered, exact
// redirect URI, response type and scope, PKCE (S256) and single-use codes, and the client when a
// token is given back; ID tokens are signed with ES256.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const ORIGIN = "http://fakes:8080";
const ISSUER = `${ORIGIN}/oidc`;
const OIDC_CLIENT = { id: "rendezroute-e2e", secret: "e2e-oidc-secret" };
/** The redirect URI registered for the OIDC client, as on a real provider. */
const OIDC_REDIRECT_URI = "http://localhost:3103/login/oidc/callback";
const OIDC_PERSON = { sub: "e2e-oidc-person", name: "Erika E2E" };
const FEDIVERSE_PERSON = { id: "42", username: "erika", display_name: "Erika (fediverse)" };

const key = generateKeyPairSync("ec", { namedCurve: "P-256" });
const base64url = (bytes: Buffer | string) => Buffer.from(bytes).toString("base64url");
const challengeOf = (verifier: string) => base64url(createHash("sha256").update(verifier).digest());

interface Grant {
  clientId: string;
  redirectUri: string;
  challenge: string;
  nonce: string | null;
  /** Who the OIDC provider approves: a person of the spec's own when it set the cookie. */
  person: { sub: string; name: string };
  /** Who the Mastodon-API server approves, by the same cookie. */
  fediverse: typeof FEDIVERSE_PERSON;
}
const grants = new Map<string, Grant>();
/** Access tokens of the Mastodon-API server and the account each stands for. */
const tokens = new Map<string, typeof FEDIVERSE_PERSON>();
const apps = new Map<string, { secret: string; redirectUri: string; scopes: string }>();

const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

async function formOf(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/** The value of the opt-in cookie `e2e-oidc-person` (letters, digits, - and _), if the browser sent it. */
const cookieSub = (request: IncomingMessage) =>
  /(?:^|; )e2e-oidc-person=([A-Za-z0-9_-]{1,64})(?:;|$)/.exec(request.headers.cookie ?? "")?.[1];

/**
 * A spec that must not share the fixed OIDC person (another spec deletes that account while it
 * runs) sets the cookie `e2e-oidc-person` on this server.
 */
function personOf(request: IncomingMessage) {
  const sub = cookieSub(request);
  return sub === undefined ? OIDC_PERSON : { sub, name: `Person ${sub}` };
}

/**
 * The same cookie for the Mastodon-API server: the account's id and username are the cookie's
 * value, so the fediverse fake can serve that person's WebFinger and actor (fediverse.ts).
 */
function fediversePersonOf(request: IncomingMessage) {
  const sub = cookieSub(request);
  return sub === undefined
    ? FEDIVERSE_PERSON
    : { id: sub, username: sub, display_name: `Person ${sub}` };
}

/** The person agrees at once: back to the redirect URI with a code. */
function approve(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  withIssuer: boolean,
) {
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const code = base64url(randomBytes(24));
  grants.set(code, {
    clientId: url.searchParams.get("client_id") ?? "",
    redirectUri,
    challenge: url.searchParams.get("code_challenge") ?? "",
    nonce: url.searchParams.get("nonce"),
    person: personOf(request),
    fediverse: fediversePersonOf(request),
  });
  const back = new URL(redirectUri);
  back.searchParams.set("code", code);
  back.searchParams.set("state", url.searchParams.get("state") ?? "");
  if (withIssuer) back.searchParams.set("iss", ISSUER);
  response.writeHead(302, { location: back.href }).end();
}

/** The grant for a token request, if client, redirect URI and PKCE verifier all match. */
function redeem(form: URLSearchParams, client: { id: string; secret: string } | undefined) {
  const grant = grants.get(form.get("code") ?? "");
  grants.delete(form.get("code") ?? "");
  const valid =
    grant !== undefined &&
    client !== undefined &&
    form.get("client_id") === client.id &&
    form.get("client_secret") === client.secret &&
    grant.clientId === client.id &&
    form.get("redirect_uri") === grant.redirectUri &&
    challengeOf(form.get("code_verifier") ?? "") === grant.challenge;
  return valid ? grant : undefined;
}

/** Answers the request if it is for a fake identity service; false otherwise. */
export async function handleIdentity(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  // OpenID Connect provider.
  if (path === "/oidc/.well-known/openid-configuration") {
    json(response, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/auth`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["ES256"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      authorization_response_iss_parameter_supported: true,
    });
    return true;
  }
  if (path === "/oidc/jwks") {
    json(response, 200, {
      keys: [{ ...key.publicKey.export({ format: "jwk" }), kid: "e2e", alg: "ES256", use: "sig" }],
    });
    return true;
  }
  if (path === "/oidc/auth") {
    const query = url.searchParams;
    const scopes = (query.get("scope") ?? "").split(" ");
    if (
      query.get("client_id") !== OIDC_CLIENT.id ||
      query.get("redirect_uri") !== OIDC_REDIRECT_URI ||
      query.get("response_type") !== "code" ||
      !scopes.includes("openid") ||
      query.get("code_challenge_method") !== "S256"
    ) {
      response.writeHead(400).end("invalid authorization request");
      return true;
    }
    approve(url, request, response, true);
    return true;
  }
  if (path === "/oidc/token" && request.method === "POST") {
    const grant = redeem(await formOf(request), OIDC_CLIENT);
    if (grant === undefined) {
      json(response, 400, { error: "invalid_grant" });
      return true;
    }
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: ISSUER,
      aud: OIDC_CLIENT.id,
      iat: now,
      exp: now + 300,
      ...grant.person,
      ...(grant.nonce === null ? {} : { nonce: grant.nonce }),
    };
    const input = `${base64url(JSON.stringify({ alg: "ES256", kid: "e2e", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
    const signature = sign("sha256", Buffer.from(input), {
      key: key.privateKey,
      dsaEncoding: "ieee-p1363",
    });
    json(response, 200, {
      access_token: base64url(randomBytes(16)),
      token_type: "Bearer",
      expires_in: 300,
      id_token: `${input}.${base64url(signature)}`,
    });
    return true;
  }
  // Mastodon-API server.
  if (path === "/api/v1/apps" && request.method === "POST") {
    const form = await formOf(request);
    const id = base64url(randomBytes(12));
    const secret = base64url(randomBytes(24));
    apps.set(id, {
      secret,
      redirectUri: form.get("redirect_uris") ?? "",
      scopes: form.get("scopes") ?? "",
    });
    json(response, 200, { id: "1", client_id: id, client_secret: secret });
    return true;
  }
  if (path === "/oauth/authorize") {
    const app = apps.get(url.searchParams.get("client_id") ?? "");
    if (
      app === undefined ||
      app.redirectUri !== url.searchParams.get("redirect_uri") ||
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("scope") !== app.scopes ||
      url.searchParams.get("code_challenge_method") !== "S256"
    ) {
      response.writeHead(400).end("invalid authorization request");
      return true;
    }
    approve(url, request, response, false);
    return true;
  }
  if (path === "/oauth/token" && request.method === "POST") {
    const form = await formOf(request);
    const app = apps.get(form.get("client_id") ?? "");
    const grant = redeem(
      form,
      app === undefined ? undefined : { id: form.get("client_id") ?? "", secret: app.secret },
    );
    if (grant === undefined) {
      json(response, 400, { error: "invalid_grant" });
      return true;
    }
    const token = base64url(randomBytes(24));
    tokens.set(token, grant.fediverse);
    json(response, 200, { access_token: token, token_type: "Bearer", scope: "read:accounts" });
    return true;
  }
  if (path === "/api/v1/accounts/verify_credentials") {
    const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
    const account = tokens.get(token);
    if (account === undefined) json(response, 401, { error: "The access token is invalid" });
    else json(response, 200, { ...account, acct: account.username });
    return true;
  }
  if (path === "/oauth/revoke" && request.method === "POST") {
    const form = await formOf(request);
    const app = apps.get(form.get("client_id") ?? "");
    if (app === undefined || app.secret !== form.get("client_secret")) {
      json(response, 401, { error: "invalid_client" });
      return true;
    }
    tokens.delete(form.get("token") ?? "");
    json(response, 200, {});
    return true;
  }
  return false;
}
