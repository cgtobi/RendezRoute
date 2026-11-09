// Rating the plan (spec 6a, decision D20): for participants, under the recap, while it is open,
// with the honesty line right under the choice; afterwards their own rating stays visible to them.
import type { RatingView } from "../../../../application/plan-views.ts";
import { RATING_LIMITS, RATING_VALUES, type RatingValue } from "../../../../domain/rating.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import type { MessageKey } from "../../../i18n/messages/en.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage } from "./format.ts";
import { Linkified } from "./linkify.tsx";

const VALUE_LABELS: Readonly<Record<RatingValue, MessageKey>> = {
  up: "rating.up",
  down: "rating.down",
};

/** Decoration only: screen readers read the label, not "thumbs up sign". */
const VALUE_ICONS: Readonly<Record<RatingValue, string>> = { up: "👍", down: "👎" };

const ValueLabel = ({ t, value }: { t: Translate; value: RatingValue }) => (
  <>
    <span aria-hidden="true">{VALUE_ICONS[value]}</span> {t(VALUE_LABELS[value])}
  </>
);

export function RatingSection({
  t,
  planId,
  rating,
  csrfToken,
  values,
  errors = [],
  notice,
}: {
  t: Translate;
  planId: string;
  rating: RatingView;
  csrfToken: string;
  /** The submitted values, kept when the form shows errors. */
  values?: { value: string; note: string } | undefined;
  errors?: readonly { field: string; code: string }[];
  /** Shown above the form, e.g. that rating closed meanwhile. */
  notice?: string | undefined;
}) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  const own = rating.own;
  const chosen = values?.value ?? own?.value ?? "";
  const errorFor = (field: string) => errors.find((e) => e.field === field);
  const valueError = errorFor("value");
  const noteError = errorFor("note");
  return (
    <section class="rating" id="rating">
      <h3>{t("rating.heading")}</h3>
      {notice !== undefined && (
        <p class="warning" role="alert">
          {notice}
        </p>
      )}
      {!rating.canRate ? (
        own === undefined ? (
          <p class="hint">{t("rating.closed")}</p>
        ) : (
          <>
            <p>
              {t("rating.yours")} <ValueLabel t={t} value={own.value} />
            </p>
            {own.note !== undefined && (
              <p class="rating-note">
                <Linkified text={own.note} />
              </p>
            )}
          </>
        )
      ) : (
        <>
          <form method="post" action={`/p/${planId}/rating`}>
            {csrf}
            <fieldset class={valueError === undefined ? undefined : "field-invalid"}>
              <legend>{t("rating.question")}</legend>
              {RATING_VALUES.map((value) => (
                <label class="choice">
                  <input
                    type="radio"
                    name="value"
                    value={value}
                    checked={chosen === value}
                    required
                    aria-describedby={
                      valueError === undefined ? undefined : "field-ratingValue-error"
                    }
                  />
                  <ValueLabel t={t} value={value} />
                </label>
              ))}
              {valueError !== undefined && (
                <p class="error" id="field-ratingValue-error">
                  {fieldErrorMessage(valueError.code, t)}
                </p>
              )}
              <p class="hint">{t("rating.honesty")}</p>
            </fieldset>
            <div class={noteError === undefined ? "field" : "field field-invalid"}>
              <label for="field-ratingNote">{t("rating.note")}</label>
              <textarea
                id="field-ratingNote"
                name="note"
                rows={3}
                maxlength={RATING_LIMITS.note}
                aria-invalid={noteError === undefined ? undefined : "true"}
                aria-describedby={noteError === undefined ? undefined : "field-ratingNote-error"}
              >
                {values?.note ?? own?.note ?? ""}
              </textarea>
              {noteError !== undefined && (
                <p class="error" id="field-ratingNote-error">
                  {fieldErrorMessage(noteError.code, t)}
                </p>
              )}
            </div>
            <button type="submit">{t("rating.submit")}</button>
          </form>
          {own !== undefined && (
            <form method="post" action={`/p/${planId}/rating/delete`}>
              {csrf}
              <button type="submit" class="secondary">
                {t("rating.remove")}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
