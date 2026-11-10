// Login with an OpenID Connect provider (spec 7 Identity, 3.11 Account takeover; decision D23), with
// openid-client: authorization code flow with PKCE (S256), state and nonce, the issuer checked in
// the response (RFC 9207) and the ID token's issuer, audience, expiry and signature. The redirect
// URI is fixed from BASE_URL, so it matches exactly. No token is kept: only the subject is returned.
import * as client from "openid-client";
import type {
  IdentityProvider,
  LoginSecrets,
  ProviderAccount,
} from "../../../application/ports.ts";
import type { TrustedFetch } from "../http/trusted-fetch.ts";

export interface OidcProviderOptions {
  issuer: URL;
  clientId: string;
  clientSecret: string | undefined;
  /** BASE_URL plus the callback path. */
  redirectUri: URL;
  fetch: TrustedFetch;
  /** Development only: a plain-http issuer (ALLOW_INSECURE_DEV). */
  allowHttp: boolean;
}

const SCOPE = "openid profile";

export function createOidcProvider(options: OidcProviderOptions): IdentityProvider {
  let configuration: Promise<client.Configuration> | undefined;
  /** Discovered once; tried again after a failure. */
  const configure = () => {
    configuration ??= client
      .discovery(
        options.issuer,
        options.clientId,
        options.clientSecret,
        options.clientSecret === undefined ? client.None() : undefined,
        {
          [client.customFetch]: options.fetch as client.CustomFetch,
          execute: [
            client.enableNonRepudiationChecks,
            ...(options.allowHttp ? [client.allowInsecureRequests] : []),
          ],
        },
      )
      .catch((error: unknown) => {
        configuration = undefined;
        throw error;
      });
    return configuration;
  };

  return {
    async startLogin() {
      const config = await configure();
      const secrets: LoginSecrets = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        codeVerifier: client.randomPKCECodeVerifier(),
      };
      const authorizationUrl = client.buildAuthorizationUrl(config, {
        redirect_uri: options.redirectUri.href,
        scope: SCOPE,
        code_challenge: await client.calculatePKCECodeChallenge(secrets.codeVerifier),
        code_challenge_method: "S256",
        state: secrets.state,
        nonce: secrets.nonce,
      });
      return { authorizationUrl, secrets };
    },

    async finishLogin(callback, secrets) {
      // Only the provider's parameters, on the configured redirect URI: never the request's host.
      const current = new URL(options.redirectUri);
      current.search = callback.search;
      try {
        const config = await configure();
        const tokens = await client.authorizationCodeGrant(config, current, {
          pkceCodeVerifier: secrets.codeVerifier,
          expectedState: secrets.state,
          expectedNonce: secrets.nonce,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (claims === undefined) return { ok: false };
        const name = (value: unknown) => (typeof value === "string" ? value : undefined);
        const account: ProviderAccount = {
          subject: `${claims.iss} ${claims.sub}`,
          names: [name(claims.name), name(claims.preferred_username)],
        };
        return { ok: true, account };
      } catch {
        // Any failed check: state, issuer, PKCE, nonce, signature, audience, expiry, or an error
        // answer from the provider. Nothing of it is logged (tokens and codes are secrets).
        return { ok: false };
      }
    },
  };
}
