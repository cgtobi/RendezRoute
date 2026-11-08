// Calendars (spec 6 feature 2, decisions D18 and I40): a one-off download per plan, by audience,
// and a personal feed per device. Feeds are fetched by third-party calendar servers, so they
// carry public fields only: never the exact start, a route or anyone's name.
import { calendarEnd } from "../domain/calendar.ts";
import type { ExactStart } from "../domain/geo.ts";
import type { PaceBand } from "../domain/pace.ts";
import type { Plan, PlanStatus } from "../domain/plan.ts";
import type { ResponseKind } from "../domain/response.ts";
import { resolveDevice } from "./devices.ts";
import { type PlanDeps, viewPlan } from "./plans.ts";

/** Responses whose plan is in the feed: rejected and removed people no longer see it. */
const IN_FEED: ReadonlySet<ResponseKind> = new Set(["interested", "requested", "joined"]);

/** One plan in a calendar. */
export interface CalendarEntry {
  planId: string;
  title: string;
  startsAt: Date;
  /** Estimated: plans have no end time (decision I40). */
  endsAt: Date;
  timeZone: string;
  areaLabel: string;
  status: PlanStatus;
  deleteAt: Date;
  /** The device hosts the plan: "your plan". */
  hosting: boolean;
  /** Only in downloads for participants and the host, never in feeds. */
  exactStart: ExactStart | undefined;
}

/** The public fields an entry is made of; a plan and every plan view have them. */
interface EntrySource {
  id: string;
  title: string;
  startsAt: Date;
  timeZone: string;
  area: { label: string };
  status: PlanStatus;
  deleteAt: Date;
  distanceMeters: number | undefined;
  pace: PaceBand | undefined;
}

/** Built field by field, so nothing else of the plan can slip into a calendar. */
function entryOf(
  source: EntrySource,
  { hosting, exactStart }: { hosting: boolean; exactStart?: ExactStart | undefined },
): CalendarEntry {
  return {
    planId: source.id,
    title: source.title,
    startsAt: source.startsAt,
    endsAt: calendarEnd(source),
    timeZone: source.timeZone,
    areaLabel: source.area.label,
    status: source.status,
    deleteAt: source.deleteAt,
    hosting,
    exactStart,
  };
}

/** The plan as a calendar entry for the requesting device's audience (spec 3.6). */
export async function planCalendar(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<{ kind: "found"; entry: CalendarEntry } | { kind: "not_found" }> {
  const result = await viewPlan(deps, request);
  if (result.kind === "not_found") return result;
  const insider = result.kind === "poster" || result.kind === "participant";
  return {
    kind: "found",
    entry: entryOf(result.view, {
      hosting: result.kind === "poster",
      exactStart: insider ? result.view.exactStart : undefined,
    }),
  };
}

/** The plans a device's feed lists: hosted ones and those it is still in, sorted by start. */
async function feedPlans(
  deps: PlanDeps,
  deviceId: string,
): Promise<{ plan: Plan; hosting: boolean }[]> {
  const linked = await deps.plans.findLinkedToDevice(deviceId);
  return linked.flatMap((entry): { plan: Plan; hosting: boolean }[] =>
    entry.role === "host"
      ? [{ plan: entry.plan, hosting: true }]
      : IN_FEED.has(entry.responseKind)
        ? [{ plan: entry.plan, hosting: false }]
        : [],
  );
}

/**
 * What the feed page shows: whether this browser has a feed, and whether it can have one: only
 * with plans to list, since feeds that reference nothing are deleted (spec 3.10).
 */
export async function viewCalendarFeed(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<{ hasFeed: boolean; canCreate: boolean }> {
  const device = await resolveDevice(deps, request.deviceToken);
  if (device === undefined) return { hasFeed: false, canCreate: false };
  return {
    hasFeed: (await deps.calendarFeeds.findForDevice(device.id)) !== undefined,
    canCreate: (await feedPlans(deps, device.id)).length > 0,
  };
}

/**
 * A new feed link for this browser, replacing any earlier one. The token exists only in this
 * result, like other secret links (spec 3.2).
 */
export async function createCalendarFeed(
  deps: PlanDeps,
  request: { deviceToken: string | undefined; language: string },
): Promise<{ kind: "created"; token: string } | { kind: "nothing_linked" }> {
  const device = await resolveDevice(deps, request.deviceToken);
  if (device === undefined || (await feedPlans(deps, device.id)).length === 0) {
    return { kind: "nothing_linked" };
  }
  const token = deps.tokens.generate();
  await deps.calendarFeeds.replace({
    id: deps.ids.rowId(),
    deviceId: device.id,
    tokenHash: deps.tokens.hash(token),
    language: request.language,
    createdAt: deps.clock.now(),
  });
  return { kind: "created", token };
}

export async function stopCalendarFeed(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<void> {
  const device = await resolveDevice(deps, request.deviceToken);
  if (device !== undefined) await deps.calendarFeeds.deleteForDevice(device.id);
}

/**
 * The feed for a calendar server, in one query for the plans. Polls are not device activity
 * (decision D18).
 */
export async function readCalendarFeed(
  deps: PlanDeps,
  request: { token: string },
): Promise<{ kind: "found"; language: string; entries: CalendarEntry[] } | { kind: "not_found" }> {
  const feed = await deps.calendarFeeds.findByTokenHash(deps.tokens.hash(request.token));
  if (feed === undefined) return { kind: "not_found" };
  const plans = await feedPlans(deps, feed.deviceId);
  return {
    kind: "found",
    language: feed.language,
    entries: plans.map(({ plan, hosting }) => entryOf(plan, { hosting })),
  };
}
