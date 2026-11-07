// Manage one's own response (spec 5 feature 6): change it, rename, or withdraw.
import type { Translate } from "../../../i18n/i18n.ts";
import type { OwnResponseView } from "../../../../application/plan-views.ts";
import { MAX_DISPLAY_NAME_LENGTH, OPEN_MODE_CHOICES } from "../../../../domain/responding.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage } from "./format.ts";

export function ManagePage(props: {
  t: Translate;
  planId: string;
  planTitle: string;
  response: OwnResponseView;
  canChange: boolean;
  csrfToken: string;
  displayName: string;
  errorCode: string | undefined;
  notice: string | undefined;
}) {
  const { t, planId, response } = props;
  const blocked = response.kind === "removed" || response.kind === "rejected";
  const invalid = props.errorCode !== undefined;

  return (
    <section class="manage">
      <h1>{t("manage.heading", { title: props.planTitle })}</h1>
      {props.notice !== undefined && (
        <p class="error" role="alert">
          {props.notice}
        </p>
      )}
      {blocked ? (
        <p class="notice">{t(`status.${response.kind}`)}</p>
      ) : (
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
              {OPEN_MODE_CHOICES.map((choice) => (
                <label class="choice">
                  <input
                    type="radio"
                    name="choice"
                    value={choice}
                    checked={response.kind === choice}
                  />
                  {t(`status.${choice}`)}
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

      <p>
        <a href={`/p/${planId}`}>{t("manage.back")}</a>
      </p>
    </section>
  );
}
