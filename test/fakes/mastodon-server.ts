// Fake Mastodon-API servers for tests (plan v1.0 step 4b): app registration, the token endpoint
// (checking client, exact redirect URI and the PKCE verifier; codes work once), verify_credentials
// and token revocation. `approve` plays the person logging in. `fediverse()` routes an OutboundHttp
// to several such servers by origin; any other host is unreachable.
import { createHash, randomBytes } from "node:crypto";
import type { OutboundHttp, OutboundResponse } from "../../src/application/ports.ts";

export interface FakeMastodonAccount {
  id: string;
  username: string;
  display_name?: string;
}

interface Grant {
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string | null;
  account: FakeMastodonAccount;
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");
const json = (url: URL, status: number, value: unknown): OutboundResponse => ({
  status,
  url,
  headers: { "content-type": "application/json" },
  body: new TextEncoder().encode(JSON.stringify(value)),
});

export class FakeMastodonServer {
  readonly origin: string;
  /** Registered apps by client ID. */
  readonly apps = new Map<string, { secret: string; redirectUris: string; scopes: string }>();
  readonly #grants = new Map<string, Grant>();
  readonly #tokens = new Map<string, FakeMastodonAccount>();
  /** Every request the app made, for assertions. */
  readonly requests: {
    method: string;
    path: string;
    body: string;
    headers: Record<string, string>;
  }[] = [];
  /** Every access token issued, and those revoked. */
  readonly issued: string[] = [];
  readonly revoked: string[] = [];
  /** Refuse app registration, as an unreachable or unwilling server would. */
  down = false;

  constructor(origin = "https://social.example") {
    this.origin = origin;
  }

  /** The person logs in and allows access: the server sends the browser back with a code. */
  approve(authorizationUrl: URL | string, account: FakeMastodonAccount): URL {
    const url = new URL(authorizationUrl);
    if (url.origin + url.pathname !== `${this.origin}/oauth/authorize`) {
      throw new Error(`not our endpoint: ${url.href}`);
    }
    const param = (name: string) => url.searchParams.get(name) ?? "";
    const code = base64url(randomBytes(24));
    this.#grants.set(code, {
      clientId: param("client_id"),
      redirectUri: param("redirect_uri"),
      scope: param("scope"),
      codeChallenge: param("code_challenge_method") === "S256" ? param("code_challenge") : null,
      account,
    });
    const callback = new URL(param("redirect_uri"));
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", param("state"));
    return callback;
  }

  /** The person declines. */
  deny(authorizationUrl: URL | string): URL {
    const url = new URL(authorizationUrl);
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    return callback;
  }

  handle(
    method: string,
    url: URL,
    body: string,
    headers: Record<string, string>,
  ): OutboundResponse {
    this.requests.push({ method, path: url.pathname, body, headers });
    const form = new URLSearchParams(body);
    if (method === "POST" && url.pathname === "/api/v1/apps") {
      if (this.down) return json(url, 503, { error: "unavailable" });
      const clientId = base64url(randomBytes(16));
      const secret = base64url(randomBytes(24));
      this.apps.set(clientId, {
        secret,
        redirectUris: form.get("redirect_uris") ?? "",
        scopes: form.get("scopes") ?? "",
      });
      return json(url, 200, {
        id: "1",
        name: form.get("client_name"),
        client_id: clientId,
        client_secret: secret,
      });
    }
    if (method === "POST" && url.pathname === "/oauth/token") return this.#token(url, form);
    if (method === "GET" && url.pathname === "/api/v1/accounts/verify_credentials") {
      const token = (headers.authorization ?? "").replace(/^Bearer /, "");
      const account = this.#tokens.get(token);
      if (account === undefined || this.revoked.includes(token)) {
        return json(url, 401, { error: "The access token is invalid" });
      }
      return json(url, 200, {
        id: account.id,
        username: account.username,
        acct: account.username,
        display_name: account.display_name ?? "",
        url: `${this.origin}/@${account.username}`,
      });
    }
    if (method === "POST" && url.pathname === "/oauth/revoke") {
      const app = this.apps.get(form.get("client_id") ?? "");
      if (app?.secret === form.get("client_secret")) this.revoked.push(form.get("token") ?? "");
      return json(url, 200, {});
    }
    return json(url, 404, { error: "Record not found" });
  }

  #token(url: URL, form: URLSearchParams): OutboundResponse {
    const error = (code: string) => json(url, 400, { error: code });
    const clientId = form.get("client_id") ?? "";
    const app = this.apps.get(clientId);
    if (app === undefined || app.secret !== form.get("client_secret")) {
      return error("invalid_client");
    }
    const code = form.get("code") ?? "";
    const grant = this.#grants.get(code);
    this.#grants.delete(code);
    if (form.get("grant_type") !== "authorization_code" || grant?.clientId !== clientId) {
      return error("invalid_grant");
    }
    // Exact redirect URI matching, against the registration and the authorization request.
    const redirectUri = form.get("redirect_uri");
    if (redirectUri !== app.redirectUris || redirectUri !== grant.redirectUri) {
      return error("invalid_grant");
    }
    // PKCE (Mastodon 4.3+): the verifier must hash to the challenge.
    if (grant.codeChallenge !== null) {
      const verifier = form.get("code_verifier") ?? "";
      if (base64url(createHash("sha256").update(verifier).digest()) !== grant.codeChallenge) {
        return error("invalid_grant");
      }
    }
    const token = base64url(randomBytes(24));
    this.#tokens.set(token, grant.account);
    this.issued.push(token);
    return json(url, 200, { access_token: token, token_type: "Bearer", scope: grant.scope });
  }
}

/** An OutboundHttp reaching these servers by origin; any other host is unreachable. */
export function fediverse(...servers: FakeMastodonServer[]): OutboundHttp {
  const route = (url: URL) => {
    const server = servers.find((s) => s.origin === url.origin);
    if (server === undefined) throw new Error(`unreachable: ${url.origin}`);
    return server;
  };
  const decode = (body: Uint8Array | undefined) =>
    body === undefined ? "" : new TextDecoder().decode(body);
  const lower = (headers: Readonly<Record<string, string>> = {}) =>
    Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    async get(url, options = {}) {
      return route(url).handle("GET", url, "", lower(options.headers));
    },
    async post(url, options) {
      return route(url).handle("POST", url, decode(options.body), lower(options.headers));
    },
  };
}
