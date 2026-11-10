// "My data on this device" (spec 3.2, 3.7, decision I45): what this browser is linked to, with
// notification switches, link tools and export per item, and deleting all of it.
import type { MyData, MyDataItem } from "../../../../application/my-data.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { isBlocked } from "../../../../domain/response.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { formatDate, formatDay, formatTime } from "./format.ts";
import { LinkTools } from "./link-tools.tsx";
import { PushSwitch } from "./push-switch.tsx";

export interface MyDataPageProps {
  t: Translate;
  language: string;
  /** The instance's time zone, for dates that belong to no plan. */
  timeZone: string;
  data: MyData;
  csrfToken: string;
  vapidPublicKey: string;
  /** One-time values for the "Get a new link" forms, one per item (decision I44). */
  nonce: () => string;
  signedOut: number | undefined;
}

function When({ t, item, language }: { t: Translate; item: MyDataItem; language: string }) {
  return (
    <span class="hint">
      {formatDay(item.startsAt, item.timeZone, language)} ·{" "}
      {formatTime(item.startsAt, item.timeZone, language)}
      {item.status === "cancelled" && ` · ${t("myData.cancelled")}`}
    </span>
  );
}

export function MyDataPage(props: MyDataPageProps) {
  const { t, data, language } = props;
  const empty =
    data.hosted.length === 0 &&
    data.responses.length === 0 &&
    data.templates.length === 0 &&
    data.mayPostSince === undefined &&
    !data.loggedIn;
  const tools = (base: string, notifications: boolean) => (
    <LinkTools
      t={t}
      base={base}
      csrfToken={props.csrfToken}
      signedOut={undefined}
      notifications={notifications}
      nonce={props.nonce()}
      compact
      returnToMyData
    />
  );
  return (
    <section class="my-data">
      <h1>{t("myData.heading")}</h1>
      {props.signedOut !== undefined && (
        <p class="notice" role="status">
          {t("linkTools.signedOut", { count: props.signedOut })}
        </p>
      )}
      <p>{t("myData.intro")}</p>
      {empty && <p>{t("myData.empty")}</p>}

      {data.hosted.length > 0 && (
        <>
          <h2>{t("myData.hosted")}</h2>
          <ul class="my-data-items">
            {data.hosted.map((item) => (
              <li>
                <a href={`/p/${item.planId}/host`}>{item.title}</a>{" "}
                <When t={t} item={item} language={language} />
                <PushSwitch
                  t={t}
                  push={{
                    endpoint: `/p/${item.planId}/host/notifications`,
                    vapidPublicKey: props.vapidPublicKey,
                  }}
                  hint={t("push.hostHint")}
                />
                <p>
                  <a href={`/p/${item.planId}/host/export.zip`}>{t("myData.export")}</a>
                </p>
                {tools(`/p/${item.planId}/host`, true)}
              </li>
            ))}
          </ul>
        </>
      )}

      {data.responses.length > 0 && (
        <>
          <h2>{t("myData.responses")}</h2>
          <ul class="my-data-items">
            {data.responses.map((item) => {
              const blocked = isBlocked(item.responseKind);
              return (
                <li>
                  <a href={`/p/${item.planId}/me`}>{item.title}</a>{" "}
                  <When t={t} item={item} language={language} />
                  <p class="hint">{t(`status.${item.responseKind}`)}</p>
                  <PushSwitch
                    t={t}
                    push={{
                      endpoint: `/p/${item.planId}/me/notifications`,
                      vapidPublicKey: props.vapidPublicKey,
                    }}
                    hint={t("push.hint")}
                    offOnly={blocked}
                  />
                  <p>
                    <a href={`/p/${item.planId}/me/export.zip`}>{t("myData.export")}</a>
                  </p>
                  {tools(`/p/${item.planId}/me`, !blocked)}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {data.templates.length > 0 && (
        <>
          <h2>{t("myData.templates")}</h2>
          <ul class="my-data-items">
            {data.templates.map((template) => (
              <li>
                <a href={`/templates/${template.id}`}>{template.title}</a>
                <p class="hint">
                  {t("template.expires", {
                    date: formatDate(template.expiresAt, template.timeZone, language),
                  })}
                </p>
                {tools(`/templates/${template.id}`, false)}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>{t("myData.calendar")}</h2>
      <p>
        {t(data.calendarFeed ? "myData.calendarOn" : "myData.calendarOff")}{" "}
        <a href="/calendar">{t("myData.calendarManage")}</a>
      </p>

      {data.mayPostSince !== undefined && (
        <p>
          {t("myData.mayPost", { date: formatDate(data.mayPostSince, props.timeZone, language) })}
        </p>
      )}

      {data.loggedIn && (
        <p>
          {t("myData.loggedIn")} <a href="/account">{t("myData.accountManage")}</a>
        </p>
      )}

      {!empty && (
        <>
          <h2>{t("myData.exportHeading")}</h2>
          <p>{t("myData.exportHint")}</p>
          <p>
            <a class="button secondary" href="/my-data/export.zip">
              {t("myData.exportAll")}
            </a>
          </p>
          <p>
            <a class="button danger" href="/my-data/delete">
              {t("myData.delete")}
            </a>
          </p>
        </>
      )}
    </section>
  );
}

export const Titles = ({ items }: { items: readonly { title: string }[] }) => (
  <ul>
    {items.map((item) => (
      <li>{item.title}</li>
    ))}
  </ul>
);

/** Lists what "Delete my data" removes, by name, before doing it (spec 3.7). */
export function DeleteMyDataPage({
  t,
  data,
  csrfToken,
}: {
  t: Translate;
  data: MyData;
  csrfToken: string;
}) {
  return (
    <section class="my-data">
      <h1>{t("myData.deleteHeading")}</h1>
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
        {data.calendarFeed && <li>{t("myData.deleteFeed")}</li>}
        {data.mayPostSince !== undefined && <li>{t("myData.deleteMayPost")}</li>}
        <li>{t("myData.deleteDevice")}</li>
      </ul>
      {data.hosted.length > 0 && <p>{t("myData.deleteNoTemplates")}</p>}
      {data.loggedIn && <p>{t("myData.deleteKeepsAccount")}</p>}
      <form method="post" action="/my-data/delete">
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <button type="submit" class="danger">
          {t("myData.deleteConfirm")}
        </button>
      </form>
      <p>
        <a href="/my-data">{t("myData.back")}</a>
      </p>
    </section>
  );
}
