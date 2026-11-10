// Accounts (spec 7 Identity, 3.11 Account takeover): the account page, logging in through a provider
// and back, renaming and logging out. Registered only when a way to log in is configured.
//
// Starting a login is a GET link, not a form: a form post redirected to the provider would be
// blocked by `form-action 'self'` (spec 3.8). It changes nothing but a pending login bound to this
// browser by the login cookie, is rate limited, and is refused when another site sends the browser
// there (`Sec-Fetch-Site: cross-site`), so no site can log anyone in unasked.
import type { Context, Hono } from "hono";
import {
  type AccountDeps,
  finishLogin,
  logOut,
  renameAccount,
  startLogin,
  viewAccount,
} from "../../../../application/accounts.ts";
import type { DisplayNameError, IdentityProviderKind } from "../../../../domain/identity.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { setLoginState, takeLoginState } from "../login-cookie.ts";
import {
  AccountPage,
  type AccountNotice,
  type LoginOption,
  LoginFailed,
} from "../views/account.tsx";
import {
  badRequest,
  clientOf,
  formField,
  readForm,
  type RouteDeps,
  secretLinkHeaders,
  tooManyRequests,
} from "./shared.tsx";

const NOTICES = ["loggedIn", "loggedOut", "renamed"] as const;

export function registerAccountRoutes(
  app: Hono<AppEnv>,
  { config, limits }: RouteDeps,
  accounts: { deps: AccountDeps; logins: readonly LoginOption[] },
) {
  const { deps, logins } = accounts;
  const deviceToken = (c: Context<AppEnv>) => readDeviceToken(c, config);

  const renderAccount = async (
    c: Context<AppEnv>,
    rename?: { value: string; error: DisplayNameError },
  ) => {
    const t = c.get("t");
    const notice: AccountNotice = NOTICES.find((name) => c.req.query(name) !== undefined);
    c.header("cache-control", "private, no-store");
    return c.render(
      <AccountPage
        t={t}
        csrfToken={c.get("csrfToken")()}
        account={await viewAccount(deps, { deviceToken: deviceToken(c) })}
        logins={logins}
        notice={rename === undefined ? notice : undefined}
        rename={rename}
      />,
      { title: t("account.heading") },
    );
  };

  app.get("/account", (c) => renderAccount(c));

  for (const { provider } of logins) {
    const callbackPath = `/login/${provider}/callback`;

    app.get(`/login/${provider}`, async (c) => {
      c.header("cache-control", "no-store");
      // Sent here by another site: start nothing, offer the login on our own page instead.
      if (c.req.header("sec-fetch-site") === "cross-site") return c.redirect("/account", 303);
      const client = clientOf(c);
      const allowed = limits.login.take(client);
      if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
      const started = await startLogin(deps, { provider });
      if (started.kind !== "redirect") {
        limits.login.refund(client);
        if (started.kind === "not_found") return c.notFound();
        const t = c.get("t");
        c.status(502);
        return c.render(<LoginFailed t={t} message={t("account.unavailable")} />, {
          title: t("account.heading"),
        });
      }
      setLoginState(c, config, started.state);
      return c.redirect(started.authorizationUrl.href, 303);
    });

    app.get(callbackPath, async (c) => {
      // The URL carries the provider's code: no referrer, no cache (spec 3.2).
      secretLinkHeaders(c);
      const result = await finishLogin(deps, {
        provider: provider satisfies IdentityProviderKind,
        callback: new URL(c.req.url),
        cookieState: takeLoginState(c, config),
        deviceToken: deviceToken(c),
      });
      if (result.kind === "failed") {
        const t = c.get("t");
        c.status(400);
        return c.render(<LoginFailed t={t} message={t("account.loginFailed")} />, {
          title: t("account.heading"),
        });
      }
      setDeviceToken(c, config, result.newDeviceToken);
      return c.redirect("/account?loggedIn", 303);
    });
  }

  app.post("/account/name", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const displayName = formField(body, "displayName");
    const result = await renameAccount(deps, { deviceToken: deviceToken(c), displayName });
    switch (result.kind) {
      case "logged_out":
        return c.redirect("/account", 303);
      case "invalid":
        c.status(422);
        return renderAccount(c, { value: displayName, error: result.error });
      case "renamed":
        return c.redirect("/account?renamed", 303);
    }
  });

  app.post("/account/logout", async (c) => {
    await logOut(deps, { deviceToken: deviceToken(c) });
    return c.redirect("/account?loggedOut", 303);
  });
}
