// Response form on the plan page (spec 5 feature 5, open join mode 3.4).
import type { Translate } from "../../../i18n/i18n.ts";
import { MAX_DISPLAY_NAME_LENGTH } from "../../../../domain/responding.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage } from "./format.ts";

export interface RespondFormState {
  csrfToken: string;
  nonce: string;
  displayName: string;
  errorCode: string | undefined;
}

export function RespondForm({
  t,
  planId,
  state,
}: {
  t: Translate;
  planId: string;
  state: RespondFormState;
}) {
  const invalid = state.errorCode !== undefined;
  return (
    <form method="post" action={`/p/${planId}/respond`} class="respond">
      <h2>{t("respond.heading")}</h2>
      <input type="hidden" name={CSRF_FIELD} value={state.csrfToken} />
      <input type="hidden" name="nonce" value={state.nonce} />
      <div class={invalid ? "field field-invalid" : "field"}>
        <label for="field-displayName">{t("respond.name")}</label>
        <input
          id="field-displayName"
          name="displayName"
          value={state.displayName}
          required
          maxlength={MAX_DISPLAY_NAME_LENGTH}
          autocomplete="nickname"
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={invalid ? "field-displayName-error" : undefined}
        />
        <p class="hint">{t("respond.nameHint")}</p>
        {state.errorCode !== undefined && (
          <p class="error" id="field-displayName-error">
            {fieldErrorMessage(state.errorCode, t)}
          </p>
        )}
      </div>
      <p class="hint">{t("respond.openModeNote")}</p>
      <div class="buttons">
        <button type="submit" name="choice" value="joined">
          {t("respond.join")}
        </button>
        <button type="submit" name="choice" value="interested" class="secondary">
          {t("respond.interested")}
        </button>
      </div>
    </form>
  );
}
