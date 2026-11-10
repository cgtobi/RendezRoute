// The account page (spec 7 Identity): the ways to log in, or the account's display name and
// "Log out". Never the provider's identifier.
import type { AccountView } from "../../../../application/accounts.ts";
import {
  type DisplayNameError,
  IDENTITY_LIMITS,
  type IdentityProviderKind,
} from "../../../../domain/identity.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage } from "./format.ts";

export type AccountNotice = "loggedIn" | "loggedOut" | "renamed" | undefined;

export interface LoginOption {
  provider: IdentityProviderKind;
  /** The button's name for it, e.g. OIDC_NAME. */
  name: string;
}

export function AccountPage(props: {
  t: Translate;
  csrfToken: string;
  account: AccountView;
  logins: readonly LoginOption[];
  notice: AccountNotice;
  /** What was typed into the name field, with its error, when renaming failed. */
  rename?: { value: string; error: DisplayNameError } | undefined;
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
          <p>
            {props.logins.map((login) => (
              <a class="button" href={`/login/${login.provider}`}>
                {t("account.loginWith", { name: login.name })}
              </a>
            ))}
          </p>
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
