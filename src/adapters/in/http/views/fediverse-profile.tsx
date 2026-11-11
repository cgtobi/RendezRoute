// A poster's fediverse profile (spec 7 ActivityPub; decisions D36, D37): its part of the account
// page (the handle chosen once, with the discoverability notice first; turning it off behind a
// fold that says the handle is retired), and the profile page a browser sees for an actor.
import type { ProfilePlan, ProfileSetting } from "../../../../application/fediverse-profile.ts";
import { fediverseAddress } from "../../../../domain/actor.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, itemWhen } from "./format.ts";
import { Item } from "./item.tsx";

export interface ProfileSectionProps {
  setting: Exclude<ProfileSetting, { kind: "unavailable" }>;
  /** The instance's host, for @handle@host. */
  host: string;
  /** What was typed, with its error, when turning on failed. */
  form?: { value: string; error: string } | undefined;
}

export function ProfileSection({
  t,
  csrfToken,
  setting,
  host,
  form,
}: ProfileSectionProps & { t: Translate; csrfToken: string }) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  if (setting.kind === "on") {
    const handle = fediverseAddress(setting.handle, host);
    return (
      <section id="profile">
        <h2>{t("profile.heading")}</h2>
        <p>
          {t("profile.on", { handle })} <a href={`/@${setting.handle}`}>{t("profile.view")}</a>
        </p>
        <details class="danger-zone">
          <summary>{t("profile.turnOff")}</summary>
          <p>{t("profile.turnOffExplain", { handle })}</p>
          <form method="post" action="/account/profile/off">
            {csrf}
            <button type="submit" class="danger">
              {t("profile.turnOffConfirm", { handle })}
            </button>
          </form>
        </details>
      </section>
    );
  }
  const error = form?.error;
  return (
    <section id="profile">
      <h2>{t("profile.heading")}</h2>
      <p>{t("profile.intro", { host })}</p>
      {/* Before anything exists: what turning it on means (spec 7: discoverability notice). */}
      <p class="notice">{t("profile.notice")}</p>
      <form method="post" action="/account/profile">
        {csrf}
        <div class={error === undefined ? "field" : "field field-invalid"}>
          <label for="field-handle">{t("profile.handle")}</label>
          <div class="inline-input">
            <span aria-hidden="true">@</span>
            <input
              id="field-handle"
              name="handle"
              maxlength={30}
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
              value={form?.value ?? setting.suggestion}
              aria-invalid={error === undefined ? undefined : "true"}
              aria-describedby={error === undefined ? "field-handle-hint" : "field-handle-error"}
            />
            <span aria-hidden="true">@{host}</span>
          </div>
          <p class="hint" id="field-handle-hint">
            {t("profile.handleHint")}
          </p>
          {error !== undefined && (
            <p class="error" id="field-handle-error">
              {fieldErrorMessage(error, t)}
            </p>
          )}
        </div>
        <button type="submit" class="secondary">
          {t("profile.turnOn")}
        </button>
      </form>
    </section>
  );
}

/** What a browser sees of an actor: the name, the instance line, the upcoming public plans. */
export function ProfilePage({
  t,
  language,
  instanceName,
  host,
  profile,
}: {
  t: Translate;
  language: string;
  instanceName: string;
  host: string;
  profile: { handle: string; displayName: string | undefined; plans: readonly ProfilePlan[] };
}) {
  return (
    <section class="profile sectioned">
      <h1>{profile.displayName ?? profile.handle}</h1>
      <p class="hint">{fediverseAddress(profile.handle, host)}</p>
      <p>{t("actorProfile.organises", { instance: instanceName })}</p>
      <section>
        <h2>{t("actorProfile.upcoming")}</h2>
        {profile.plans.length === 0 ? (
          <p>{t("actorProfile.none")}</p>
        ) : (
          <ul class="items">
            {profile.plans.map((plan) => (
              <Item
                href={`/p/${plan.planId}`}
                title={plan.title}
                meta={[
                  t(`activity.${plan.activity}`),
                  itemWhen(t, { ...plan, status: "active" }, language),
                  plan.areaLabel,
                ].join(" · ")}
              />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
