// An identity provider for use-case tests: the login succeeds when the callback carries the login's
// state and a code made from its nonce, as `approve` builds it.
import type {
  IdentityProvider,
  LoginSecrets,
  ProviderAccount,
} from "../../src/application/ports.ts";

export class FakeIdentityProvider implements IdentityProvider {
  #count = 0;
  readonly #accounts = new Map<string, ProviderAccount>();
  unavailable = false;
  /** Off to test that the use cases check the state themselves, whatever the adapter does. */
  checksState = true;

  async startLogin() {
    if (this.unavailable) throw new Error("provider unreachable");
    const n = ++this.#count;
    const secrets: LoginSecrets = {
      state: `state-${String(n).padStart(40, "0")}`,
      nonce: `nonce-${n}`,
      codeVerifier: `verifier-${n}`,
    };
    const authorizationUrl = new URL("https://login.example/auth");
    authorizationUrl.searchParams.set("state", secrets.state);
    authorizationUrl.searchParams.set("nonce", secrets.nonce);
    return { authorizationUrl, secrets };
  }

  /** The person logs in as `account`. */
  approve(authorizationUrl: URL, account: ProviderAccount): URL {
    const callback = new URL("https://runs.example.org/login/oidc/callback");
    const code = `code-for-${authorizationUrl.searchParams.get("nonce") ?? ""}`;
    this.#accounts.set(code, account);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "");
    return callback;
  }

  async finishLogin(callback: URL, secrets: LoginSecrets) {
    const code = callback.searchParams.get("code") ?? "";
    const account = this.#accounts.get(code);
    this.#accounts.delete(code);
    const valid =
      account !== undefined &&
      (!this.checksState || callback.searchParams.get("state") === secrets.state) &&
      code === `code-for-${secrets.nonce}`;
    return valid ? { ok: true as const, account } : { ok: false as const };
  }
}
