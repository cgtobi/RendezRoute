// Accounts (spec 7 Identity, 3.11 Account takeover): the account page, logging in through a provider
// and back, renaming and logging out. Registered only when a way to log in is configured.
//
// No login starts with a redirect from a form: `form-action 'self'` (spec 3.8) would block it.
// OIDC starts with a GET link: it changes nothing but a pending login bound to this browser by the
// login cookie, is rate limited, and is refused when another site sends the browser there
// (`Sec-Fetch-Site: cross-site`). A fediverse login starts with a form (CSRF-protected: it may
// register an app at the server) that answers with a "Continue to <server>" page and its link, so
// the person also sees where they are sent (decision D24).
import type { Context, Hono } from "hono";
import {
  createProfile,
  profileSetting,
  retireProfile,
} from "../../../../application/fediverse-profile.ts";
import type { ProfileSectionProps } from "../views/fediverse-profile.tsx";
import {
  type AccountDeps,
  claimDeviceData,
  finishLogin,
  logOut,
  renameAccount,
  startLogin,
  viewAccount,
} from "../../../../application/accounts.ts";
import type { LookupHasher } from "../../../../application/ports.ts";
import type { DisplayNameError, IdentityProviderKind } from "../../../../domain/identity.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { setLoginState, takeLoginState } from "../login-cookie.ts";
import {
  deleteAccount,
  exportAccountData,
  viewAccountData,
} from "../../../../application/account-data.ts";
import { exportZip, zipDownload } from "../export-zip.ts";
import {
  AccountPage,
  DeleteAccountPage,
  type AccountNotice,
  ContinueLogin,
  type FediverseLoginForm,
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
import { accountEmailProps, registerAccountEmailForms } from "./email.tsx";
import { accountNtfyProps, registerAccountNtfyForms } from "./ntfy.tsx";
import { accountTelegramProps, registerAccountTelegramForms } from "./telegram.tsx";
import {
  accountFediverseMessagesProps,
  registerAccountFediverseMessagesForms,
} from "./fediverse-messages.tsx";

const NOTICES = ["loggedIn", "loggedOut", "renamed", "claimed", "accountDeleted"] as const;

/** Where providers send the browser back. A fediverse server's own key follows this path (I50). */
export const OIDC_CALLBACK_PATH = "/login/oidc/callback";
export const FEDIVERSE_CALLBACK_PATH = "/login/fediverse/callback/";

/** A fediverse server's own callback: its key is a keyed hash, so the URL names no server. */
export const fediverseCallbackUri =
  (baseUrl: URL, lookup: LookupHasher) =>
  (server: string): URL =>
    new URL(
      `${FEDIVERSE_CALLBACK_PATH}${lookup.hash(`fediverse-callback:${server}`).slice(0, 32)}`,
      baseUrl,
    );

export function registerAccountRoutes(
  app: Hono<AppEnv>,
  routeDeps: RouteDeps,
  accounts: { deps: AccountDeps; logins: readonly LoginOption[] },
) {
  const { config, limits } = routeDeps;
  const { deps, logins } = accounts;
  const deviceToken = (c: Context<AppEnv>) => readDeviceToken(c, config);

  const renderAccount = async (
    c: Context<AppEnv>,
    forms: {
      rename?: { value: string; error: DisplayNameError };
      fediverse?: FediverseLoginForm;
      email?: { value: string; error: string };
      profile?: { value: string; error: string };
      /** Switching fediverse messages on failed: the address could not be found (D47). */
      fediverseMessages?: { failed: true };
    } = {},
  ) => {
    const t = c.get("t");
    const failed =
      forms.rename !== undefined ||
      forms.fediverse !== undefined ||
      forms.email !== undefined ||
      forms.profile !== undefined ||
      forms.fediverseMessages !== undefined;
    const notice: AccountNotice = failed
      ? undefined
      : NOTICES.find((name) => c.req.query(name) !== undefined);
    c.header("cache-control", "private, no-store");
    const accountData = await viewAccountData(deps, { deviceToken: deviceToken(c) });
    return c.render(
      <AccountPage
        t={t}
        csrfToken={c.get("csrfToken")()}
        account={await viewAccount(deps, { deviceToken: deviceToken(c) })}
        data={accountData.kind === "account" ? accountData.data : undefined}
        language={c.get("language")}
        timeZone={config.defaultTimezone}
        logins={logins}
        notice={notice}
        rename={forms.rename}
        fediverse={forms.fediverse}
        email={await accountEmailProps(deps, deviceToken(c), forms.email)}
        ntfy={await accountNtfyProps(deps, deviceToken(c))}
        telegram={await accountTelegramProps(deps, deviceToken(c))}
        fediverseMessages={await accountFediverseMessagesProps(
          deps,
          deviceToken(c),
          config.instanceName,
          forms.fediverseMessages?.failed,
        )}
        profile={await profileProps(deviceToken(c), forms.profile)}
        profileNotice={failed ? undefined : profileNotice(c)}
      />,
      { title: t("account.heading") },
    );
  };

  const loginFailed = (c: Context<AppEnv>, status: 400 | 502, message: string) => {
    const t = c.get("t");
    c.status(status);
    return c.render(<LoginFailed t={t} message={message} />, { title: t("account.heading") });
  };

  /** The fediverse profile's part of the page (decision D36); none while federation is off. */
  const profileProps = async (
    token: string | undefined,
    form: { value: string; error: string } | undefined,
  ): Promise<ProfileSectionProps | undefined> => {
    const setting = await profileSetting(deps, { deviceToken: token });
    return setting.kind === "unavailable"
      ? undefined
      : { setting, host: config.baseUrl.hostname, form };
  };
  const profileNotice = (c: Context<AppEnv>) => {
    const t = c.get("t");
    if (c.req.query("profileOn") !== undefined) return t("profile.turnedOn");
    const off = c.req.query("profileOff");
    return off === undefined ? undefined : t("profile.turnedOff", { count: Number(off) || 0 });
  };

  app.get("/account", (c) => renderAccount(c));

  // Turning the fediverse profile on: the handle is chosen once (decision D36).
  app.post("/account/profile", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const handle = formField(body, "handle");
    const client = clientOf(c);
    const allowed = limits.profile.take(client);
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    const result = await createProfile(deps, { deviceToken: deviceToken(c), handle });
    // Only made keys count; a refused handle is checked before any are made.
    if (result.kind !== "created") limits.profile.refund(client);
    switch (result.kind) {
      case "unavailable":
        return c.redirect("/account", 303);
      case "created":
        return c.redirect("/account?profileOn#profile", 303);
      case "invalid":
        c.status(422);
        return renderAccount(c, { profile: { value: handle, error: result.code } });
    }
  });

  // Turning it off retires the handle for good (decision D37).
  app.post("/account/profile/off", async (c) => {
    const result = await retireProfile(deps, { deviceToken: deviceToken(c) });
    return c.redirect(
      result.kind === "retired"
        ? `/account?profileOff=${result.plansNowLinkOnly}#profile`
        : "/account",
      303,
    );
  });
  registerAccountEmailForms(app, routeDeps, (c, email) => renderAccount(c, { email }));
  registerAccountNtfyForms(app, routeDeps);
  registerAccountTelegramForms(app, routeDeps);
  registerAccountFediverseMessagesForms(app, routeDeps, deps, (c) =>
    renderAccount(c, { fediverseMessages: { failed: true } }),
  );

  if (logins.some((login) => login.provider === "oidc")) {
    app.get("/login/oidc", async (c) => {
      c.header("cache-control", "no-store");
      // Sent here by another site: start nothing, offer the login on our own page instead.
      if (c.req.header("sec-fetch-site") === "cross-site") return c.redirect("/account", 303);
      const client = clientOf(c);
      const allowed = limits.login.take(client);
      if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
      const started = await startLogin(deps, { provider: "oidc" });
      if (started.kind !== "redirect") {
        limits.login.refund(client);
        if (started.kind !== "unavailable") return c.notFound();
        return loginFailed(c, 502, c.get("t")("account.unavailable"));
      }
      setLoginState(c, config, started.state);
      return c.redirect(started.authorizationUrl.href, 303);
    });
  }

  if (logins.some((login) => login.provider === "fediverse")) {
    app.post("/login/fediverse", async (c) => {
      const body = await readForm(c);
      if (body === undefined) return badRequest(c);
      const client = clientOf(c);
      const allowed = limits.login.take(client);
      if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
      const server = formField(body, "server");
      const started = await startLogin(deps, { provider: "fediverse", server });
      // Only a typo is free: a server that fails was still contacted, and refunding it would let
      // anyone send this instance's requests to servers they pick without limit.
      if (started.kind === "invalid") limits.login.refund(client);
      switch (started.kind) {
        case "not_found":
          return c.notFound();
        case "invalid":
          c.status(422);
          return renderAccount(c, { fediverse: { value: server, error: started.error } });
        case "unavailable":
          return loginFailed(c, 502, c.get("t")("account.serverUnavailable"));
        case "redirect": {
          setLoginState(c, config, started.state);
          c.header("cache-control", "no-store");
          c.header("referrer-policy", "no-referrer");
          const t = c.get("t");
          const host = started.authorizationUrl.host;
          return c.render(
            <ContinueLogin t={t} server={host} authorizationUrl={started.authorizationUrl} />,
            { title: t("account.continue", { server: host }) },
          );
        }
      }
    });
  }

  // Each fediverse server has its own callback, with a key made from the server (decision I50).
  const callbackPaths = {
    oidc: OIDC_CALLBACK_PATH,
    fediverse: `${FEDIVERSE_CALLBACK_PATH}:key`,
  } as const;
  for (const { provider } of logins) {
    app.get(callbackPaths[provider], async (c) => {
      // The URL carries the provider's code: no referrer, no cache (spec 3.2).
      secretLinkHeaders(c);
      const result = await finishLogin(deps, {
        provider: provider satisfies IdentityProviderKind,
        callback: new URL(c.req.url),
        cookieState: takeLoginState(c, config),
        deviceToken: deviceToken(c),
      });
      if (result.kind === "failed") return loginFailed(c, 400, c.get("t")("account.loginFailed"));
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
        return renderAccount(c, { rename: { value: displayName, error: result.error } });
      case "renamed":
        return c.redirect("/account?renamed", 303);
    }
  });

  app.post("/account/claim", async (c) => {
    const result = await claimDeviceData(deps, { deviceToken: deviceToken(c) });
    return c.redirect(result.kind === "claimed" ? "/account?claimed" : "/account", 303);
  });

  app.get("/account/export.zip", async (c) => {
    const result = await exportAccountData(deps, { deviceToken: deviceToken(c) });
    if (result.kind === "not_found") return c.notFound();
    const zip = exportZip(result.data, {
      t: c.get("t"),
      language: c.get("language"),
      baseUrl: config.baseUrl,
    });
    const day = result.data.exportedAt.toISOString().slice(0, 10);
    return zipDownload(c, zip, `rendezroute-account-${day}.zip`);
  });

  app.get("/account/delete", async (c) => {
    const result = await viewAccountData(deps, { deviceToken: deviceToken(c) });
    if (result.kind === "logged_out") return c.redirect("/account", 303);
    const t = c.get("t");
    c.header("cache-control", "private, no-store");
    return c.render(
      <DeleteAccountPage
        t={t}
        csrfToken={c.get("csrfToken")()}
        data={result.data}
        host={config.baseUrl.hostname}
      />,
      { title: t("account.deleteHeading") },
    );
  });

  app.post("/account/delete", async (c) => {
    const result = await deleteAccount(deps, { deviceToken: deviceToken(c) });
    return c.redirect(result.kind === "deleted" ? "/account?accountDeleted" : "/account", 303);
  });

  app.post("/account/logout", async (c) => {
    await logOut(deps, { deviceToken: deviceToken(c) });
    return c.redirect("/account?loggedOut", 303);
  });
}
