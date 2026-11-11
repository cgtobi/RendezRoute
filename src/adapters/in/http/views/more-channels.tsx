// "More ways to be notified" (decision D33): the channels besides push and email in one fold on the
// manage, host and account pages, open while one of them is on or waiting. ntfy shows the secret
// topic to subscribe to; Telegram follows in step 7b.
import type { NtfySetting } from "../../../../application/ntfy.ts";
import { topicUrl } from "../../../../domain/ntfy.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { CSRF_FIELD } from "../csrf.ts";

export interface NtfySwitchProps {
  setting: NtfySetting;
  /** The page's path; the forms post to `<base>/ntfy` and `<base>/ntfy/off`. */
  base: string;
  /** Rejected and removed people may only turn ntfy off (spec 3.5). */
  offOnly?: boolean;
  /** The account's own topic, on the account page: its own hint. */
  forAccount?: boolean;
  /** On the host page: everyone who manages the plan sees the topic (as for email, I55). */
  shared?: boolean;
}

export function MoreChannels({
  t,
  csrfToken,
  ntfy,
}: {
  t: Translate;
  csrfToken: string;
  ntfy: NtfySwitchProps | undefined;
}) {
  if (ntfy === undefined) return null;
  const inUse = ntfy.setting.state !== "off";
  if (ntfy.offOnly === true && !inUse) return null;
  return (
    <details class="more-channels" open={inUse}>
      <summary>{t("channels.more")}</summary>
      <NtfySwitch t={t} csrfToken={csrfToken} {...ntfy} />
    </details>
  );
}

function NtfySwitch({
  t,
  csrfToken,
  setting,
  base,
  offOnly = false,
  forAccount = false,
  shared = false,
}: NtfySwitchProps & { t: Translate; csrfToken: string }) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  const turnOff = (
    <form method="post" action={`${base}/ntfy/off`}>
      {csrf}
      <button type="submit" class="secondary">
        {t("ntfy.off")}
      </button>
    </form>
  );
  if (setting.state === "off") {
    return (
      <div class="ntfy-switch" id="ntfy">
        <h3>{t("ntfy.label")}</h3>
        <p class="hint">
          {t(forAccount ? "ntfy.accountHint" : "ntfy.hint", { server: serverName(setting) })}
        </p>
        <form method="post" action={`${base}/ntfy`}>
          {csrf}
          <button type="submit" class="secondary">
            {t("ntfy.setUp")}
          </button>
        </form>
      </div>
    );
  }
  const url = setting.server === undefined ? undefined : topicUrl(setting.server, setting.topic);
  const topic = url !== undefined && (
    <>
      <p class="link-box">
        <code>{url}</code>
      </p>
      <p>
        <a class="button secondary" href={url} rel="noopener noreferrer">
          {t("ntfy.open")}
        </a>
      </p>
    </>
  );
  // Without NTFY_URL, or for rejected and removed people, only turning off is left.
  if (offOnly || setting.server === undefined) {
    return (
      <div class="ntfy-switch" id="ntfy">
        <h3>{t("ntfy.label")}</h3>
        {turnOff}
      </div>
    );
  }
  return (
    <div class="ntfy-switch" id="ntfy">
      <h3>{t("ntfy.label")}</h3>
      {setting.state === "pending" ? (
        <p class="notice" role="status">
          {t("ntfy.pending")}
        </p>
      ) : (
        <p class="hint">{t("ntfy.on")}</p>
      )}
      {topic}
      {shared && <p class="hint">{t("ntfy.hostShared")}</p>}
      <div class="button-row">
        {setting.state === "pending" && (
          <form method="post" action={`${base}/ntfy`}>
            {csrf}
            <button type="submit" class="secondary">
              {t("ntfy.resend")}
            </button>
          </form>
        )}
        {turnOff}
      </div>
    </div>
  );
}

/** The server as people know it: its host, e.g. "ntfy.sh". */
const serverName = (setting: NtfySetting): string => setting.server?.host ?? "";
