// "More ways to be notified" (decision D33): the channels besides push and email in one fold on the
// manage, host and account pages, open while one of them is on or waiting. ntfy shows the secret
// topic to subscribe to; Telegram the deep link into the bot, where Start confirms (D34).
import type { FediverseMessagesSetting } from "../../../../application/fediverse-messages.ts";
import type { NtfySetting } from "../../../../application/ntfy.ts";
import type { TelegramSetting } from "../../../../application/telegram.ts";
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

export interface TelegramSwitchProps {
  setting: TelegramSetting;
  /** The page's path; the forms post to `<base>/telegram` and `<base>/telegram/off`. */
  base: string;
  /** Rejected and removed people may only turn Telegram off (spec 3.5). */
  offOnly?: boolean;
  /** The account's own chat, on the account page: its own hint. */
  forAccount?: boolean;
  /** On the host page: everyone who manages the plan sees the deep link, like ntfy's topic. */
  shared?: boolean;
}

/** The fediverse direct messages on the account page, for accounts with a fediverse login (D47). */
export interface FediverseMessagesSwitchProps {
  setting: FediverseMessagesSetting;
  /** The instance's name, which the messages come from. */
  instance: string;
  /** The address could not be found when switching on: nothing was turned on. */
  failed?: boolean;
}

/**
 * A notice, once per page, that the plan item's saved email address and ntfy topic belong to the
 * item and not to a person: everyone holding the link sees and changes them. Shown only while one
 * of them is saved.
 */
export function SharedSettingsNotice({
  t,
  link,
  email,
  ntfy,
}: {
  t: Translate;
  link: "host" | "response";
  email: { setting: { state: string } } | undefined;
  ntfy: { setting: { state: string } } | undefined;
}) {
  const saved = [email, ntfy].some((props) => props !== undefined && props.setting.state !== "off");
  if (!saved) return null;
  return (
    <p class="hint">{t(link === "host" ? "channels.sharedHost" : "channels.sharedResponse")}</p>
  );
}

export function MoreChannels({
  t,
  csrfToken,
  ntfy,
  telegram,
  fediverseMessages,
}: {
  t: Translate;
  csrfToken: string;
  ntfy: NtfySwitchProps | undefined;
  telegram: TelegramSwitchProps | undefined;
  fediverseMessages?: FediverseMessagesSwitchProps | undefined;
}) {
  // Rejected and removed people see a channel only to turn it off.
  const shown = <P extends { setting: { state: string }; offOnly?: boolean }>(props?: P) =>
    props !== undefined && !(props.offOnly === true && props.setting.state === "off")
      ? props
      : undefined;
  const ntfyShown = shown(ntfy);
  const telegramShown = shown(telegram);
  if (ntfyShown === undefined && telegramShown === undefined && fediverseMessages === undefined) {
    return null;
  }
  const inUse =
    [ntfyShown, telegramShown, fediverseMessages].some(
      (props) => props !== undefined && props.setting.state !== "off",
    ) || fediverseMessages?.failed === true;
  return (
    <details class="more-channels" open={inUse}>
      <summary>{t("channels.more")}</summary>
      {ntfyShown !== undefined && <NtfySwitch t={t} csrfToken={csrfToken} {...ntfyShown} />}
      {telegramShown !== undefined && (
        <TelegramSwitch t={t} csrfToken={csrfToken} {...telegramShown} />
      )}
      {fediverseMessages !== undefined && (
        <FediverseMessagesSwitch t={t} csrfToken={csrfToken} {...fediverseMessages} />
      )}
    </details>
  );
}

function FediverseMessagesSwitch({
  t,
  csrfToken,
  setting,
  instance,
  failed = false,
}: FediverseMessagesSwitchProps & { t: Translate; csrfToken: string }) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  return (
    <div class="fediverse-messages-switch" id="fediverse-messages">
      <h3>{t("fediverseDm.label")}</h3>
      {failed && (
        <p class="error" role="alert">
          {t("fediverseDm.notFound")}
        </p>
      )}
      <p class="hint">
        {setting.paused === true
          ? t("fediverseDm.paused")
          : t(setting.state === "on" ? "fediverseDm.on" : "fediverseDm.hint", { instance })}
      </p>
      <form
        method="post"
        action={
          setting.state === "on" ? "/account/fediverse-messages/off" : "/account/fediverse-messages"
        }
      >
        {csrf}
        <button type="submit" class="secondary">
          {t(setting.state === "on" ? "fediverseDm.off" : "fediverseDm.turnOn")}
        </button>
      </form>
    </div>
  );
}

function TelegramSwitch({
  t,
  csrfToken,
  setting,
  base,
  offOnly = false,
  forAccount = false,
  shared = false,
}: TelegramSwitchProps & { t: Translate; csrfToken: string }) {
  const csrf = <input type="hidden" name={CSRF_FIELD} value={csrfToken} />;
  const turnOff = (
    <form method="post" action={`${base}/telegram/off`}>
      {csrf}
      <button type="submit" class="secondary">
        {t("telegram.off")}
      </button>
    </form>
  );
  if (setting.state === "off") {
    return (
      <div class="telegram-switch" id="telegram">
        <h3>{t("telegram.label")}</h3>
        <p class="hint">{t(forAccount ? "telegram.accountHint" : "telegram.hint")}</p>
        <form method="post" action={`${base}/telegram`}>
          {csrf}
          <button type="submit" class="secondary">
            {t("telegram.connect")}
          </button>
        </form>
      </div>
    );
  }
  if (setting.state === "on" || offOnly) {
    return (
      <div class="telegram-switch" id="telegram">
        <h3>{t("telegram.label")}</h3>
        {setting.state === "on" && setting.sending && <p class="hint">{t("telegram.onPage")}</p>}
        {turnOff}
      </div>
    );
  }
  if (setting.start === undefined) {
    // Telegram has not told the bot's name: no deep link to offer, only turning off.
    return (
      <div class="telegram-switch" id="telegram">
        <h3>{t("telegram.label")}</h3>
        <p class="notice" role="status">
          {t("telegram.unreachable")}
        </p>
        {turnOff}
      </div>
    );
  }
  // The deep link carries the one-time code; pressing Start in the bot confirms (decision D34).
  const { botName, startToken } = setting.start;
  const deepLink = `https://t.me/${encodeURIComponent(botName)}?start=${startToken}`;
  return (
    <div class="telegram-switch" id="telegram">
      <h3>{t("telegram.label")}</h3>
      <p class="notice" role="status">
        {t("telegram.pending")}
      </p>
      {shared && <p class="hint">{t("telegram.hostShared")}</p>}
      <div class="button-row">
        <a class="button secondary" href={deepLink} rel="noopener noreferrer">
          {t("telegram.open")}
        </a>
        {turnOff}
      </div>
    </div>
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
    <p class="link-box">
      <code>{url}</code>
    </p>
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
      {/* One row, as for email and Telegram (design check, 0.8 wrap-up). */}
      <div class="button-row">
        <a class="button secondary" href={url} rel="noopener noreferrer">
          {t("ntfy.open")}
        </a>
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
