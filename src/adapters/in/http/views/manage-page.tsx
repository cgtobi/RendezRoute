// Manage one's own response (spec 5 feature 6): change it, rename, or withdraw.
import type { Translate } from "../../../i18n/i18n.ts";
import type { OwnResponseView } from "../../../../application/plan-views.ts";
import type { ResponseChoice } from "../../../../domain/requests.ts";
import { isBlocked } from "../../../../domain/response.ts";
import { MAX_DISPLAY_NAME_LENGTH } from "../../../../domain/responding.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { BackLink } from "./back-link.tsx";
import { fieldErrorMessage } from "./format.ts";
import { type LinkEmail, LinkTools } from "./link-tools.tsx";
import { EmailSwitch, type EmailSwitchProps } from "./email-switch.tsx";
import { MoreChannels, type NtfySwitchProps, type TelegramSwitchProps } from "./more-channels.tsx";
import { type PushSettings, PushSwitch } from "./push-switch.tsx";
import { ResponseStatus } from "./response-status.tsx";

export function ManagePage(props: {
  t: Translate;
  planId: string;
  planTitle: string;
  response: OwnResponseView;
  canChange: boolean;
  /** Kinds offered for this plan's join mode (spec 3.4). */
  choices: readonly ResponseChoice[];
  csrfToken: string;
  /** The notification switch; left out for rejected and removed people (spec 3.5). */
  push: PushSettings;
  displayName: string;
  errorCode: string | undefined;
  notice: string | undefined;
  /** Other devices removed by "Sign out all other devices", right after it (spec 3.2). */
  signedOut: number | undefined;
  /** One-time value for "Get a new link" (decision I44). */
  linkNonce: string;
  /** "Email me my links" (decision D31). */
  linkEmail: LinkEmail | undefined;
  /** Email notifications; undefined without SMTP (decision D31). */
  email: EmailSwitchProps | undefined;
  /** ntfy; undefined without NTFY_URL (decision D33). */
  ntfy: NtfySwitchProps | undefined;
  /** Telegram; undefined without a bot (decision D34). */
  telegram: TelegramSwitchProps | undefined;
}) {
  const { t, planId, response } = props;
  const blocked = isBlocked(response.kind);
  const invalid = props.errorCode !== undefined;

  return (
    <section class="manage">
      <BackLink href={`/p/${planId}`} label={t("manage.back")} />
      <h1>{t("manage.heading", { title: props.planTitle })}</h1>
      {props.notice !== undefined && (
        <p class="error" role="alert">
          {props.notice}
        </p>
      )}
      {/* The page's heading already says whose response this is. */}
      <ResponseStatus t={t} response={response} titled={false} />
      {blocked ? null : (
        <form method="post" action={`/p/${planId}/me`}>
          <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
          <div class={invalid ? "field field-invalid" : "field"}>
            <label for="field-displayName">{t("respond.name")}</label>
            <input
              id="field-displayName"
              name="displayName"
              value={props.displayName}
              required
              maxlength={MAX_DISPLAY_NAME_LENGTH}
              aria-invalid={invalid ? "true" : undefined}
              aria-describedby={invalid ? "field-displayName-error" : undefined}
            />
            {props.errorCode !== undefined && (
              <p class="error" id="field-displayName-error">
                {fieldErrorMessage(props.errorCode, t)}
              </p>
            )}
          </div>
          {props.canChange ? (
            <fieldset>
              <legend>{t("manage.choice")}</legend>
              {props.choices.map((choice) => (
                <label class="choice">
                  <input
                    type="radio"
                    name="choice"
                    value={choice}
                    checked={response.kind === choice}
                  />
                  {/* "Request to join" until a request exists; then its status. */}
                  {choice === "requested" && response.kind !== "requested"
                    ? t("respond.request")
                    : t(`status.${choice}`)}
                </label>
              ))}
            </fieldset>
          ) : (
            <>
              <input type="hidden" name="choice" value={response.kind} />
              <p class="hint">{t("manage.locked")}</p>
            </>
          )}
          <button type="submit">{t("manage.save")}</button>
        </form>
      )}

      <PushSwitch t={t} push={props.push} hint={t("push.hint")} offOnly={blocked} />
      {props.email !== undefined && (
        <EmailSwitch t={t} csrfToken={props.csrfToken} {...props.email} offOnly={blocked} />
      )}
      <MoreChannels
        t={t}
        csrfToken={props.csrfToken}
        ntfy={props.ntfy === undefined ? undefined : { ...props.ntfy, offOnly: blocked }}
        telegram={
          props.telegram === undefined ? undefined : { ...props.telegram, offOnly: blocked }
        }
      />

      <p>
        <a class="button secondary" href={`/p/${planId}/me/export.zip`}>
          {t("export.response")}
        </a>
      </p>

      <LinkTools
        t={t}
        base={`/p/${planId}/me`}
        csrfToken={props.csrfToken}
        signedOut={props.signedOut}
        notifications={!blocked}
        nonce={props.linkNonce}
        email={props.linkEmail}
      />

      <details class="withdraw">
        <summary>{t("manage.withdraw")}</summary>
        <p>{t("manage.withdrawExplain")}</p>
        <form method="post" action={`/p/${planId}/me/withdraw`}>
          <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
          <button type="submit" class="danger">
            {t("manage.withdrawConfirm")}
          </button>
        </form>
      </details>
    </section>
  );
}
