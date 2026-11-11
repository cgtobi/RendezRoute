// The account page (spec 7 Identity): the ways to log in (an OIDC button, a fediverse server field),
// or the account's display name and "Log out". Never the provider's identifier.
import type { AccountData } from "../../../../application/account-data.ts";
import type { AccountView } from "../../../../application/accounts.ts";
import type { ClaimCounts } from "../../../../application/ports.ts";
import type { FediverseServerError } from "../../../../domain/fediverse.ts";
import { type DisplayNameError, IDENTITY_LIMITS } from "../../../../domain/identity.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { BackLink } from "./back-link.tsx";
import { EmailSwitch, type EmailSwitchProps } from "./email-switch.tsx";
import { MoreChannels, type NtfySwitchProps, type TelegramSwitchProps } from "./more-channels.tsx";
import { fieldErrorMessage, formatDate, itemWhen } from "./format.ts";
import { Item, ItemList } from "./item.tsx";
import { Titles } from "./my-data.tsx";
import { Status } from "./status.tsx";

export type AccountNotice =
  | "loggedIn"
  | "loggedOut"
  | "renamed"
  | "claimed"
  | "accountDeleted"
  | undefined;

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
  /** What the account owns, when logged in (step 5b). */
  data?: AccountData | undefined;
  language: string;
  /** The instance's time zone, for dates that belong to no plan. */
  timeZone: string;
  /** The account's own address (decision D31); undefined without SMTP. */
  email?: EmailSwitchProps | undefined;
  /** The account's own ntfy topic (decision D33); undefined without NTFY_URL. */
  ntfy?: NtfySwitchProps | undefined;
  /** The account's own Telegram chat (decision D34); undefined without a bot. */
  telegram?: TelegramSwitchProps | undefined;
}) {
  const { t, account } = props;
  // Just after logging in, the status says so; no separate notice (decision D27).
  const notice =
    props.notice === undefined || props.notice === "loggedIn"
      ? undefined
      : t(`account.${props.notice}`);
  // Each part in its own section, divided by hairlines; the first way to log in, or moving this
  // browser's things into the account, is the page's main action (decision D27).
  return (
    <section class="account sectioned">
      <h1>{t("account.heading")}</h1>
      {notice !== undefined && (
        <p class="notice" role="status">
          {notice}
        </p>
      )}
      {account.kind === "logged_out" ? (
        <>
          <p>{t("account.intro")}</p>
          {props.logins.map((login, index) =>
            login.provider === "oidc" ? (
              <p>
                <a class={index === 0 ? "button" : "button secondary"} href="/login/oidc">
                  {t("account.loginWith", { name: login.name })}
                </a>
              </p>
            ) : (
              <FediverseLogin
                t={t}
                csrfToken={props.csrfToken}
                servers={login.servers}
                form={props.fediverse}
                primary={index === 0}
              />
            ),
          )}
        </>
      ) : (
        <>
          <Status
            state="loggedIn"
            text={t(props.notice === "loggedIn" ? "account.loggedIn" : "account.linked")}
            announce={props.notice === "loggedIn"}
          />
          <section>
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
                    props.rename === undefined
                      ? "field-displayName-hint"
                      : "field-displayName-error"
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
              <button type="submit" class="secondary">
                {t("account.save")}
              </button>
            </form>
          </section>
          {(props.email !== undefined ||
            props.ntfy !== undefined ||
            props.telegram !== undefined) && (
            <section>
              {props.email !== undefined && (
                <EmailSwitch t={t} csrfToken={props.csrfToken} {...props.email} />
              )}
              <MoreChannels
                t={t}
                csrfToken={props.csrfToken}
                ntfy={props.ntfy}
                telegram={props.telegram}
              />
            </section>
          )}
          <ClaimSection t={t} csrfToken={props.csrfToken} claimable={account.claimable} />
          {props.data !== undefined && (
            <AccountDataSection
              t={t}
              data={props.data}
              language={props.language}
              timeZone={props.timeZone}
            />
          )}
          <section>
            <form method="post" action="/account/logout">
              <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
              <p class="hint">{t("account.logoutHint")}</p>
              <button type="submit" class="secondary">
                {t("account.logout")}
              </button>
            </form>
          </section>
        </>
      )}
    </section>
  );
}

/** What the account owns, its export and deletion, and when it expires (spec 3.7, 3.10). */
function AccountDataSection(props: {
  t: Translate;
  data: AccountData;
  language: string;
  timeZone: string;
}) {
  const { t, data, language } = props;
  const empty =
    data.hosted.length === 0 && data.responses.length === 0 && data.templates.length === 0;
  return (
    <section class="account-data">
      <h2>{t("account.dataHeading")}</h2>
      {empty && <p>{t("account.dataEmpty")}</p>}
      <ItemList
        heading={t("myData.hosted")}
        level={3}
        items={data.hosted}
        item={(item) => (
          <Item href={`/p/${item.planId}`} title={item.title} meta={itemWhen(t, item, language)} />
        )}
      />
      <ItemList
        heading={t("myData.responses")}
        level={3}
        items={data.responses}
        item={(item) => (
          <Item href={`/p/${item.planId}`} title={item.title} meta={itemWhen(t, item, language)} />
        )}
      />
      <ItemList
        heading={t("myData.templates")}
        level={3}
        items={data.templates}
        item={(template) => <Item href={`/templates/${template.id}`} title={template.title} />}
      />
      {data.mayPostSince !== undefined && (
        <p>
          {t("account.mayPost", {
            date: formatDate(data.mayPostSince, props.timeZone, language),
          })}
        </p>
      )}
      <p class="hint">
        {t("account.deleteAt", { date: formatDate(data.deleteAt, props.timeZone, language) })}
      </p>
      <p class="button-row">
        <a class="button secondary" href="/account/export.zip">
          {t("account.export")}
        </a>
        <a class="button danger" href="/account/delete">
          {t("account.deleteLink")}
        </a>
      </p>
    </section>
  );
}

/** Lists what deleting the account removes, by name, before doing it (spec 3.7). */
export function DeleteAccountPage(props: { t: Translate; csrfToken: string; data: AccountData }) {
  const { t, data } = props;
  return (
    <section class="account">
      <BackLink href="/account" label={t("account.back")} />
      <h1>{t("account.deleteHeading")}</h1>
      <p>{t("myData.deleteExplain")}</p>
      <ul>
        {data.hosted.length > 0 && (
          <li>
            {t("myData.deletePlans", { count: data.hosted.length })}
            <Titles items={data.hosted} />
          </li>
        )}
        {data.responses.length > 0 && (
          <li>
            {t("myData.deleteResponses", { count: data.responses.length })}
            <Titles items={data.responses} />
          </li>
        )}
        {data.templates.length > 0 && (
          <li>
            {t("myData.deleteTemplates", { count: data.templates.length })}
            <Titles items={data.templates} />
          </li>
        )}
        {data.mayPostSince !== undefined && <li>{t("account.deleteMayPost")}</li>}
        <li>{t("account.deleteItself")}</li>
      </ul>
      {data.hosted.length > 0 && <p>{t("myData.deleteNoTemplates")}</p>}
      <p>{t("account.deleteLogsOut")}</p>
      <form method="post" action="/account/delete">
        <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
        <button type="submit" class="danger">
          {t("account.deleteConfirm")}
        </button>
      </form>
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
    <section class="account-claim">
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
      <form method="post" action="/account/claim">
        <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
        <button type="submit">{t("account.claimSubmit")}</button>
      </form>
    </section>
  );
}

/** Logging in with a fediverse account: the person's server, as a domain or handle. */
function FediverseLogin(props: {
  t: Translate;
  csrfToken: string;
  servers: readonly string[] | undefined;
  form: FediverseLoginForm | undefined;
  /** The first way to log in: the page's main action. */
  primary: boolean;
}) {
  const { t, form } = props;
  return (
    <section>
      <h2>{t("account.fediverseHeading")}</h2>
      <form method="post" action="/login/fediverse">
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
        <button type="submit" class={props.primary ? undefined : "secondary"}>
          {t("account.fediverseSubmit")}
        </button>
      </form>
    </section>
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
      <BackLink href="/account" label={t("account.back")} />
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
      <BackLink href="/account" label={t("account.tryAgain")} />
      <h1>{t("account.heading")}</h1>
      <p class="warning" role="alert">
        {message}
      </p>
    </section>
  );
}
