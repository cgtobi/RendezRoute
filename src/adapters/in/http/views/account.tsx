// The account page (spec 7 Identity): the ways to log in (an OIDC button, a fediverse server field),
// or the account's display name and "Log out". Never the provider's identifier.
import type { AccountView } from "../../../../application/accounts.ts";
import type { ClaimCounts } from "../../../../application/ports.ts";
import type { FediverseServerError } from "../../../../domain/fediverse.ts";
import { type DisplayNameError, IDENTITY_LIMITS } from "../../../../domain/identity.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage } from "./format.ts";

export type AccountNotice = "loggedIn" | "loggedOut" | "renamed" | "claimed" | undefined;

export type LoginOption =
  /** The button's name for it: OIDC_NAME. */
  | { provider: "oidc"; name: string }
  /** The accepted servers, when FEDIVERSE_LOGIN_SERVERS lists them (decision D24). */
  | { provider: "fediverse"; servers: readonly string[] | undefined };

/** The fediverse server as typed, with its error, when the login could not start. */
export interface FediverseLoginForm {
  value: string;
  error: FediverseServerError;
}

export function AccountPage(props: {
  t: Translate;
  csrfToken: string;
  account: AccountView;
  logins: readonly LoginOption[];
  notice: AccountNotice;
  /** What was typed into the name field, with its error, when renaming failed. */
  rename?: { value: string; error: DisplayNameError } | undefined;
  fediverse?: FediverseLoginForm | undefined;
}) {
  const { t, account } = props;
  const notice = props.notice === undefined ? undefined : t(`account.${props.notice}`);
  return (
    <section class="account">
      <h1>{t("account.heading")}</h1>
      {notice !== undefined && (
        <p class="notice" role="status">
          {notice}
        </p>
      )}
      {account.kind === "logged_out" ? (
        <>
          <p>{t("account.intro")}</p>
          {props.logins.map((login) =>
            login.provider === "oidc" ? (
              <p>
                <a class="button" href="/login/oidc">
                  {t("account.loginWith", { name: login.name })}
                </a>
              </p>
            ) : (
              <FediverseLogin
                t={t}
                csrfToken={props.csrfToken}
                servers={login.servers}
                form={props.fediverse}
              />
            ),
          )}
        </>
      ) : (
        <>
          <p>{t("account.linked")}</p>
          <form method="post" action="/account/name">
            <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
            <div class={props.rename === undefined ? "field" : "field field-invalid"}>
              <label for="field-displayName">{t("account.displayName")}</label>
              <input
                id="field-displayName"
                name="displayName"
                maxlength={IDENTITY_LIMITS.displayName}
                value={props.rename?.value ?? account.displayName ?? ""}
                aria-invalid={props.rename === undefined ? undefined : "true"}
                aria-describedby={
                  props.rename === undefined ? "field-displayName-hint" : "field-displayName-error"
                }
              />
              <p class="hint" id="field-displayName-hint">
                {t("account.displayNameHint")}
              </p>
              {props.rename !== undefined && (
                <p class="error" id="field-displayName-error">
                  {fieldErrorMessage(props.rename.error, t)}
                </p>
              )}
            </div>
            <button type="submit">{t("account.save")}</button>
          </form>
          <ClaimSection t={t} csrfToken={props.csrfToken} claimable={account.claimable} />
          <form method="post" action="/account/logout">
            <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
            <p class="hint">{t("account.logoutHint")}</p>
            <button type="submit" class="secondary">
              {t("account.logout")}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

/**
 * Claiming (spec 7 Identity): what this browser holds outside the account, and the button that
 * moves it in. Shown only when there is something to move.
 */
function ClaimSection(props: { t: Translate; csrfToken: string; claimable: ClaimCounts }) {
  const { t, claimable } = props;
  if (claimable.plans + claimable.responses + claimable.templates === 0) return null;
  return (
    <form method="post" action="/account/claim" class="account-claim">
      <h2>{t("account.claimHeading")}</h2>
      <p>{t("account.claimIntro")}</p>
      <ul>
        {claimable.plans > 0 && <li>{t("account.claimPlans", { count: claimable.plans })}</li>}
        {claimable.responses > 0 && (
          <li>{t("account.claimResponses", { count: claimable.responses })}</li>
        )}
        {claimable.templates > 0 && (
          <li>{t("account.claimTemplates", { count: claimable.templates })}</li>
        )}
      </ul>
      <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
      <button type="submit">{t("account.claimSubmit")}</button>
    </form>
  );
}

/** Logging in with a fediverse account: the person's server, as a domain or handle. */
function FediverseLogin(props: {
  t: Translate;
  csrfToken: string;
  servers: readonly string[] | undefined;
  form: FediverseLoginForm | undefined;
}) {
  const { t, form } = props;
  return (
    <form method="post" action="/login/fediverse">
      <h2>{t("account.fediverseHeading")}</h2>
      <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
      <div class={form === undefined ? "field" : "field field-invalid"}>
        <label for="field-server">{t("account.fediverseServer")}</label>
        <input
          id="field-server"
          name="server"
          required
          autocomplete="off"
          spellcheck={false}
          value={form?.value ?? ""}
          aria-invalid={form === undefined ? undefined : "true"}
          aria-describedby={form === undefined ? "field-server-hint" : "field-server-error"}
        />
        <p class="hint" id="field-server-hint">
          {props.servers === undefined
            ? t("account.fediverseHint")
            : t("account.fediverseServers", { servers: props.servers.join(", ") })}{" "}
          {t("account.fediverseHandleHint")}
        </p>
        {form !== undefined && (
          <p class="error" id="field-server-error">
            {fieldErrorMessage(form.error, t)}
          </p>
        )}
      </div>
      <button type="submit">{t("account.fediverseSubmit")}</button>
    </form>
  );
}

/**
 * Where a fediverse login goes next: a link, not a redirect, since `form-action 'self'` would
 * block a form's redirect to another server, and so the person sees which server it is.
 */
export function ContinueLogin(props: { t: Translate; server: string; authorizationUrl: URL }) {
  const { t } = props;
  return (
    <section class="account">
      <h1>{t("account.continue", { server: props.server })}</h1>
      <p>{t("account.continueText")}</p>
      <p>
        <a class="button" href={props.authorizationUrl.href}>
          {t("account.continue", { server: props.server })}
        </a>
      </p>
    </section>
  );
}

/** A login that did not work, at the callback: nothing about why (spec 3.11). */
export function LoginFailed({ t, message }: { t: Translate; message: string }) {
  return (
    <section class="account">
      <p class="warning" role="alert">
        {message}
      </p>
      <p>
        <a href="/account">{t("account.tryAgain")}</a>
      </p>
    </section>
  );
}
