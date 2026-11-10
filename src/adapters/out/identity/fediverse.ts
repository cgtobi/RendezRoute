// Login with a fediverse account through the Mastodon API (spec 7 Identity, 3.11 Account takeover;
// decisions D23, D24, I50): Mastodon, GoToSocial, Akkoma and Pleroma.
//
// - Each login registers its own app at the server (`read:accounts`) and keeps it only in the
//   encrypted pending login: no app outlives the login, so none goes stale when a server cleans up
//   apps without tokens, and the database lists no servers.
// - Each server gets its own redirect URI, `/login/fediverse/callback/<key>` with a keyed hash of
//   the server: a server only sends its own codes there, so a code coming back to another server's
//   callback is refused instead of being handed to the server the login started at (mix-up).
// - PKCE (S256, where the server supports it) and state; the code is exchanged only with the
//   server the login started at, the account read, and the token given back in any case.
// - Every request goes through OutboundHttp: people type the server's name (SSRF, spec 3.11).
import { createHash, randomBytes } from "node:crypto";
import { fediverseAccount } from "../../../domain/fediverse.ts";
import type {
  IdentityProvider,
  LoginSecrets,
  OutboundHttp,
  OutboundResponse,
} from "../../../application/ports.ts";

export interface FediverseProviderOptions {
  http: OutboundHttp;
  /** The server's own redirect URI: BASE_URL, the callback path and a keyed hash of the server. */
  callbackUri: (server: string) => URL;
  /** The instance's name and address, shown on the server's consent page. */
  clientName: string;
  website: URL;
}

const SCOPE = "read:accounts";
const MAX_BYTES = 64 * 1024;

const random = () => randomBytes(32).toString("base64url");
const form = (values: Record<string, string>) =>
  new TextEncoder().encode(new URLSearchParams(values).toString());
const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
  accept: "application/json",
} as const;

/** The JSON object of a successful answer, or undefined. */
function jsonOf(response: OutboundResponse): Record<string, unknown> | undefined {
  if (response.status !== 200) return undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(response.body));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const nonEmptyString = (value: unknown) =>
  typeof value === "string" && value !== "" ? value : undefined;

export function createFediverseProvider(options: FediverseProviderOptions): IdentityProvider {
  const { http } = options;
  const redirectUriFor = options.callbackUri;

  return {
    async startLogin(request) {
      const server = request?.server;
      if (server === undefined) throw new Error("A fediverse login needs a server.");
      const redirectUri = redirectUriFor(server).href;
      const registered = jsonOf(
        await http.post(new URL("/api/v1/apps", server), {
          headers: FORM_HEADERS,
          body: form({
            client_name: options.clientName,
            redirect_uris: redirectUri,
            scopes: SCOPE,
            website: options.website.href,
          }),
          maxBytes: MAX_BYTES,
        }),
      );
      const id = nonEmptyString(registered?.client_id);
      const secret = nonEmptyString(registered?.client_secret);
      if (id === undefined || secret === undefined) {
        throw new Error("The server refused the app registration.");
      }
      const secrets: LoginSecrets = {
        state: random(),
        // OAuth without OpenID Connect has no nonce; PKCE and state do its work.
        nonce: "",
        codeVerifier: random(),
        server,
        client: { id, secret },
      };
      const authorizationUrl = new URL("/oauth/authorize", server);
      for (const [name, value] of Object.entries({
        response_type: "code",
        client_id: id,
        redirect_uri: redirectUri,
        scope: SCOPE,
        state: secrets.state,
        code_challenge: createHash("sha256").update(secrets.codeVerifier).digest("base64url"),
        code_challenge_method: "S256",
      })) {
        authorizationUrl.searchParams.set(name, value);
      }
      return { authorizationUrl, secrets };
    },

    async finishLogin(callback, secrets) {
      const failed = { ok: false } as const;
      // The server the login started at, never one the callback names; and the callback must be
      // that server's own (mix-up).
      const { server, client } = secrets;
      const code = callback.searchParams.get("code");
      if (
        server === undefined ||
        client === undefined ||
        callback.pathname !== redirectUriFor(server).pathname ||
        callback.searchParams.has("error") ||
        callback.searchParams.get("state") !== secrets.state ||
        code === null
      ) {
        return failed;
      }
      let token: string | undefined;
      try {
        token = nonEmptyString(
          jsonOf(
            await http.post(new URL("/oauth/token", server), {
              headers: FORM_HEADERS,
              body: form({
                grant_type: "authorization_code",
                code,
                client_id: client.id,
                client_secret: client.secret,
                redirect_uri: redirectUriFor(server).href,
                code_verifier: secrets.codeVerifier,
                scope: SCOPE,
              }),
              maxBytes: MAX_BYTES,
            }),
          )?.access_token,
        );
        if (token === undefined) return failed;
        const answer = jsonOf(
          await http.get(new URL("/api/v1/accounts/verify_credentials", server), {
            headers: { authorization: `Bearer ${token}`, accept: "application/json" },
            maxBytes: MAX_BYTES,
          }),
        );
        const account = fediverseAccount(answer?.id, answer?.username);
        if (account === undefined) return failed;
        return {
          ok: true,
          account: {
            subject: `${server} ${account.id}`,
            handle: `@${account.username}@${new URL(server).host}`,
            names: [nonEmptyString(answer?.display_name), account.username],
          },
        };
      } catch {
        // Unreachable server or a refused step; nothing of it is logged (codes are secrets).
        return failed;
      } finally {
        // The account was read, or reading failed: the token is given back either way.
        if (token !== undefined) await revoke(server, client, token);
      }
    },
  };

  /** Best effort: the token expires on the server anyway. */
  async function revoke(server: string, client: { id: string; secret: string }, token: string) {
    try {
      await http.post(new URL("/oauth/revoke", server), {
        headers: FORM_HEADERS,
        body: form({ client_id: client.id, client_secret: client.secret, token }),
        maxBytes: MAX_BYTES,
      });
    } catch {
      // Nothing to do.
    }
  }
}
