// Email on the manage, host and account pages (spec 7 Optional notification channels, decision
// D31): an address field (or the account's confirmed address, in one click), then "waiting for
// confirmation", then the address in use. Works without JavaScript, unlike the push switch.
import type { EmailSetting } from "../../../../application/email.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage } from "./format.ts";
import { RequiredHint } from "./line-field.tsx";

export interface EmailSwitchProps {
  setting: EmailSetting;
  /** The page's path; the forms post to `<base>/email` and `<base>/email/off`. */
  base: string;
  /** The address as typed, with its error, when it was refused. */
  form?: { value: string; error: string } | undefined;
  /** Rejected and removed people may only turn emails off (spec 3.5). */
  offOnly?: boolean;
  /** The account's own address, on the account page: its own texts. */
  forAccount?: boolean;
  /** On the host page: everyone who manages the plan sees the address (decision I55). */
  shared?: boolean;
}

/**
 * The email block. Only "Turn off" for rejected and removed people (spec 3.5), and for a stored
 * address once SMTP is switched off (decision D31).
 */
/** The texts that differ between a plan's or response's address and the account's own. */
const TEXTS = {
  item: { label: "email.label", hint: "email.hint", on: "email.on" },
  account: { label: "email.accountLabel", hint: "email.accountHint", on: "email.accountOn" },
} as const;

export function EmailSwitch({
  t,
  csrfToken,
  setting,
  base,
  form,
  offOnly = false,
  forAccount = false,
  shared = false,
}: EmailSwitchProps & { t: Translate; csrfToken: string }) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  const sharedHint = shared && <p class="hint">{t("email.hostShared")}</p>;
  const texts = TEXTS[forAccount ? "account" : "item"];
  const turnOff = (
    <form method="post" action={`${base}/email/off`}>
      {csrf}
      <button type="submit" class="secondary">
        {t("email.off")}
      </button>
    </form>
  );
  const onlyOff = offOnly || (setting.state !== "off" && !setting.sending);
  if (setting.state === "on" && form === undefined) {
    return (
      <div class="email-switch" id="email">
        <p class="hint">{t(texts.on, { address: setting.address })}</p>
        {sharedHint}
        {turnOff}
      </div>
    );
  }
  if (onlyOff) {
    return setting.state === "off" ? null : (
      <div class="email-switch" id="email">
        {turnOff}
      </div>
    );
  }
  const invalid = form !== undefined;
  return (
    <div class="email-switch" id="email">
      {setting.state === "pending" && !invalid && (
        <>
          <p class="notice" role="status">
            {t("email.pending", { address: setting.address })}
          </p>
          {sharedHint}
          <div class="button-row">
            <form method="post" action={`${base}/email`}>
              {csrf}
              <input type="hidden" name="address" value={setting.address} />
              <button type="submit" class="secondary">
                {t("email.resend")}
              </button>
            </form>
            {turnOff}
          </div>
        </>
      )}
      {setting.state === "off" && !invalid && setting.accountAddress !== undefined && (
        <form method="post" action={`${base}/email/account`}>
          {csrf}
          <button type="submit" class="secondary">
            {t("email.useAccount", { address: setting.accountAddress })}
          </button>
        </form>
      )}
      {(setting.state === "off" || invalid) && (
        <form method="post" action={`${base}/email`}>
          {csrf}
          <div class={invalid ? "field field-invalid" : "field"}>
            <label for="field-email">{t(texts.label)}</label>
            <input
              id="field-email"
              name="address"
              type="email"
              required
              placeholder=" "
              autocomplete="email"
              maxlength={254}
              value={form?.value ?? ""}
              aria-required="true"
              aria-invalid={invalid ? "true" : undefined}
              aria-describedby={invalid ? "field-email-error" : "field-email-hint"}
            />
            <RequiredHint t={t} controlId="field-email" invalid={invalid} />
            <p class="hint" id="field-email-hint">
              {t(texts.hint)}
              {shared && ` ${t("email.hostShared")}`}
            </p>
            {form !== undefined && (
              <p class="error" id="field-email-error">
                {fieldErrorMessage(form.error, t)}
              </p>
            )}
          </div>
          <button type="submit" class="secondary">
            {t("email.submit")}
          </button>
        </form>
      )}
    </div>
  );
}
