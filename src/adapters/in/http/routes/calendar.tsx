// Calendar download per plan, the feed page and the personal feed (spec 6 feature 2, D18, I40).
import type { Context, Hono } from "hono";
import {
  createCalendarFeed,
  planCalendar,
  readCalendarFeed,
  stopCalendarFeed,
  viewCalendarFeed,
} from "../../../../application/calendar.ts";
import { DEFAULT_LANGUAGE, isLanguage, translator } from "../../../i18n/i18n.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import { writeCalendar } from "../ics.ts";
import { calendarEvents } from "../views/calendar-events.ts";
import { CalendarPage } from "../views/calendar-page.tsx";
import { clientOf, type RouteDeps, secretLinkHeaders, tooManyRequests } from "./shared.tsx";

/** How often subscribed calendars should fetch the feed again. */
const FEED_REFRESH_HOURS = 1;

function calendarResponse(c: Context<AppEnv>, ics: string) {
  c.header("content-type", "text/calendar; charset=utf-8");
  return c.body(ics);
}

export function registerCalendarRoutes(app: Hono<AppEnv>, { config, planDeps, limits }: RouteDeps) {
  /** One-off download for the requesting audience; may hold the exact start (spec 6 feature 2). */
  app.get("/p/:id/calendar.ics", async (c) => {
    const result = await planCalendar(planDeps, {
      planId: c.req.param("id"),
      deviceToken: readDeviceToken(c, config),
    });
    if (result.kind === "not_found") return c.notFound();
    c.header("cache-control", "private, no-store");
    c.header("content-disposition", 'attachment; filename="plan.ics"');
    const events = calendarEvents([result.entry], {
      t: c.get("t"),
      language: c.get("language"),
      baseUrl: config.baseUrl,
      deletionEntries: false,
    });
    return calendarResponse(c, writeCalendar({ now: planDeps.clock.now(), events }));
  });

  const renderPage = (
    c: Context<AppEnv>,
    state: { hasFeed: boolean; canCreate: boolean },
    token?: string,
  ) => {
    const t = c.get("t");
    // A page showing the link must not be cached or leak it through the referrer (spec 3.2).
    if (token === undefined) c.header("cache-control", "private, no-store");
    else secretLinkHeaders(c);
    const https = token === undefined ? undefined : new URL(`/c/${token}`, config.baseUrl);
    return c.render(
      <CalendarPage
        t={t}
        csrfToken={c.get("csrfToken")()}
        hasFeed={state.hasFeed}
        canCreate={state.canCreate}
        link={
          https === undefined
            ? undefined
            : { https: https.href, webcal: `webcal://${https.host}${https.pathname}` }
        }
      />,
      { title: t("calendar.title") },
    );
  };

  app.get("/calendar", async (c) =>
    renderPage(c, await viewCalendarFeed(planDeps, { deviceToken: readDeviceToken(c, config) })),
  );

  app.post("/calendar", async (c) => {
    // Reserved first, given back unless a link was created (decision I32).
    const client = clientOf(c);
    const allowed = limits.calendar.take(client);
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    const result = await createCalendarFeed(planDeps, {
      deviceToken: readDeviceToken(c, config),
      language: c.get("language"),
    });
    if (result.kind === "nothing_linked") {
      limits.calendar.refund(client);
      return c.redirect("/calendar", 303);
    }
    return renderPage(c, { hasFeed: true, canCreate: true }, result.token);
  });

  app.post("/calendar/stop", async (c) => {
    await stopCalendarFeed(planDeps, { deviceToken: readDeviceToken(c, config) });
    return c.redirect("/calendar", 303);
  });

  /**
   * The feed, fetched by calendar servers: public fields only, no cookies read or set, and no
   * device activity (decision D18). The path carries the secret token (spec 3.2).
   */
  app.get("/c/:token", async (c) => {
    const result = await readCalendarFeed(planDeps, { token: c.req.param("token") });
    secretLinkHeaders(c);
    c.header("x-robots-tag", "noindex");
    if (result.kind === "not_found") return c.body(null, 404);
    const language = isLanguage(result.language) ? result.language : DEFAULT_LANGUAGE;
    c.header("content-language", language);
    const events = calendarEvents(result.entries, {
      t: translator(language),
      language,
      baseUrl: config.baseUrl,
      deletionEntries: true,
    });
    return calendarResponse(
      c,
      writeCalendar({
        name: config.instanceName,
        refreshHours: FEED_REFRESH_HOURS,
        now: planDeps.clock.now(),
        events,
      }),
    );
  });
}
