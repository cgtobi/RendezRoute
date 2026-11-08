// Response form on the plan page (spec 5 feature 5; join modes 3.4, 6 feature 1).
import type { Translate } from "../../../i18n/i18n.ts";
import type { JoinMode } from "../../../../domain/plan.ts";
import { MAX_REQUEST_NOTE_LENGTH } from "../../../../domain/requests.ts";
import { MAX_DISPLAY_NAME_LENGTH } from "../../../../domain/responding.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage } from "./format.ts";

export interface RespondFormState {
  csrfToken: string;
  nonce: string;
  displayName: string;
  /** Only in approval mode. */
  requestNote: string;
  errorCode: string | undefined;
  noteErrorCode: string | undefined;
}

export function RespondForm({
  t,
  planId,
  joinMode,
  state,
}: {
  t: Translate;
  planId: string;
  joinMode: JoinMode;
  state: RespondFormState;
}) {
  const invalid = state.errorCode !== undefined;
  const noteInvalid = state.noteErrorCode !== undefined;
  const approval = joinMode === "approval";
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
      {approval && (
        <div class={noteInvalid ? "field field-invalid" : "field"}>
          <label for="field-requestNote">{t("respond.note")}</label>
          <textarea
            id="field-requestNote"
            name="requestNote"
            rows={3}
            maxlength={MAX_REQUEST_NOTE_LENGTH}
            aria-invalid={noteInvalid ? "true" : undefined}
          >
            {state.requestNote}
          </textarea>
          <p class="hint">{t("respond.noteHint")}</p>
          {state.noteErrorCode !== undefined && (
            <p class="error">{fieldErrorMessage(state.noteErrorCode, t)}</p>
          )}
        </div>
      )}
      <p class="hint">{t(approval ? "respond.approvalNote" : "respond.openModeNote")}</p>
      <div class="buttons">
        {approval ? (
          <button type="submit" name="choice" value="requested">
            {t("respond.request")}
          </button>
        ) : (
          <button type="submit" name="choice" value="joined">
            {t("respond.join")}
          </button>
        )}
        <button type="submit" name="choice" value="interested" class="secondary">
          {t("respond.interested")}
        </button>
      </div>
    </form>
  );
}
