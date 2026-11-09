// Plan use cases (spec 5 features 1 and 3).
import { type PlanTheme, planTheme } from "../domain/color.ts";
import type { Units } from "../domain/pace.ts";
import type { Plan } from "../domain/plan.ts";
import {
  type FieldError,
  type PlanDraft,
  type PlanInput,
  validatePlanInput,
} from "../domain/plan-input.ts";
import { hasRecap, shortenedRecapWindow } from "../domain/recap.ts";
import type { RecapWindow } from "../domain/schedule.ts";
import { audienceFor, canSee } from "../domain/visibility.ts";
import {
  applyRouteDefaults,
  parseRouteTrim,
  type Route,
  routeStats,
  trimRoute,
} from "../domain/route.ts";
import { canRespond } from "../domain/responding.ts";
import { type DeviceDeps, ensureDevice, resolveDevice } from "./devices.ts";
import {
  type PlanViewForParticipant,
  type PlanViewForPoster,
  type PlanViewForResponder,
  type PlanViewForViewer,
  type PlanPreview,
  previewOf,
  ratingResultDue,
  viewForParticipant,
  viewForPoster,
  viewForResponder,
  viewForViewer,
} from "./plan-views.ts";
import type { Result } from "../domain/result.ts";
import type {
  CalendarFeedRepository,
  ChannelRepository,
  FormNonceRepository,
  RatingRepository,
  JobQueue,
  PlanRepository,
  RecapRepository,
  ResponseRepository,
  RouteParseError,
  RouteParser,
  SentReminderRepository,
  TemplateRepository,
} from "./ports.ts";

export interface PlanDeps extends DeviceDeps {
  plans: PlanRepository;
  responses: ResponseRepository;
  routeParser: RouteParser;
  limits: { horizonDays: number; maxRetentionDays: number };
  /** Personal calendar feeds (spec 6 feature 2). */
  calendarFeeds: CalendarFeedRepository;
  /** Recap contributions (spec 6 feature 5). */
  recap: RecapRepository;
  /** Repeatable templates (spec 3.10). */
  templates: TemplateRepository;
  /** One-time values of "Get a new link" forms (decision I44). */
  formNonces: FormNonceRepository;
  /** Plan ratings (spec 6a). */
  ratings: RatingRepository;
  /** Notification channels, the job queue that delivers to them and sent reminders (spec 6 feature 3). */
  notify?:
    | { channels: ChannelRepository; jobs: JobQueue; reminders: SentReminderRepository }
    | undefined;
}

/** One-time form values (decision I9). */
export const CREATION_NONCE = /^[A-Za-z0-9_-]{16,64}$/;

export type CreatePlanResult =
  | (CreatedPlan & {
      /** The recap window, if the chosen one was shortened to fit the retention (spec 3.10). */
      recapWindowShortened: RecapWindow | undefined;
    })
  | { kind: "duplicate"; planId: string }
  | { kind: "invalid"; errors: FieldError[] }
  | { kind: "bad_request" };

/** Parses an upload and hides its ends as chosen; trimmed points are never stored (D13). */
export function readRoute(
  deps: Pick<PlanDeps, "routeParser">,
  gpx: Uint8Array,
  routeTrim: string | undefined,
): Result<Route, RouteParseError | "route_trimmed_away" | "choice_invalid"> {
  const trim = parseRouteTrim(routeTrim ?? "");
  if (!trim.ok) return trim;
  const parsed = deps.routeParser.parse(gpx);
  return parsed.ok ? trimRoute(parsed.value, trim.value) : parsed;
}

export async function createPlan(
  deps: PlanDeps,
  request: {
    input: PlanInput;
    units: Units;
    /** BCP 47 tag negotiated from the browser (decision P7). */
    language: string;
    /** One-time value from the form (decision I9). */
    creationNonce: string;
    deviceToken: string | undefined;
    /** Optional GPX upload; an empty file counts as none (spec 5 feature 2). */
    gpx?: Uint8Array | undefined;
    /** Meters to hide at both ends of the route, as submitted (decision D13). */
    routeTrim?: string | undefined;
  },
): Promise<CreatePlanResult> {
  const used = await checkCreationNonce(deps, request.creationNonce);
  if (used !== undefined) return used;

  const now = deps.clock.now();
  const rules = { now, ...deps.limits };
  let input = request.input;
  let route: Route | undefined;
  if (request.gpx !== undefined && request.gpx.byteLength > 0) {
    // The form first: parsing a large file is the costly part, and filling empty fields from
    // the route can add errors but never remove them.
    const typed = validatePlanInput(input, rules, request.units);
    if (!typed.ok) return { kind: "invalid", errors: typed.errors };
    const parsed = readRoute(deps, request.gpx, request.routeTrim);
    if (!parsed.ok) return { kind: "invalid", errors: [{ field: "gpx", code: parsed.error }] };
    route = parsed.value;
    input = applyRouteDefaults(input, routeStats(route), "fill");
  }

  const draft = validatePlanInput(input, rules, request.units);
  if (!draft.ok) {
    // A distance taken from the route is the route's problem, not the empty field's (D7, D10).
    const distanceFromRoute = route !== undefined && request.input.distanceKm.trim() === "";
    const errors = draft.errors.map((error) =>
      distanceFromRoute && error.field === "distanceKm"
        ? { field: "gpx" as const, code: "route_too_long" }
        : error,
    );
    return { kind: "invalid", errors };
  }

  const stored = await storeNewPlan(deps, draft.value, { ...request, route });
  return stored.kind === "created"
    ? {
        ...stored,
        recapWindowShortened: shortenedRecapWindow(
          request.input.recapWindow,
          draft.value.recapWindow,
        ),
      }
    : stored;
}

/** A created plan, for the links page; the host link exists only here (spec 3.2). */
export interface CreatedPlan {
  kind: "created";
  planId: string;
  /** For the share links on the links page. */
  title: string;
  hostToken: string;
  newDeviceToken: string | undefined;
  deleteAt: Date;
  /** Canonical IANA zone of the plan, for displaying dates. */
  timeZone: string;
}

/** Whether a creation nonce is well-formed and unused (decision I9). */
export async function checkCreationNonce(
  deps: Pick<PlanDeps, "plans">,
  nonce: string,
): Promise<{ kind: "bad_request" } | { kind: "duplicate"; planId: string } | undefined> {
  if (!CREATION_NONCE.test(nonce)) return { kind: "bad_request" };
  const existing = await deps.plans.findIdByCreationNonce(nonce);
  return existing === undefined ? undefined : { kind: "duplicate", planId: existing };
}

/** Stores a validated plan with a new host link, linking the device as host (spec 3.2). */
export async function storeNewPlan(
  deps: PlanDeps,
  draft: PlanDraft,
  request: {
    language: string;
    creationNonce: string;
    deviceToken: string | undefined;
    route: Route | undefined;
  },
): Promise<CreatedPlan | { kind: "duplicate"; planId: string }> {
  const now = deps.clock.now();
  const hostToken = deps.tokens.generate();
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  const plan: Plan = {
    ...draft,
    id: deps.ids.planId(),
    posterLanguage: request.language,
    visibility: "link",
    status: "active",
    hasRoute: request.route !== undefined,
    recapWindowSetAt: undefined,
    recapClosedAt: undefined,
    ratingsClosedAt: undefined,
    ratingTally: undefined,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await deps.plans.create({
      plan,
      hostTokenHash: deps.tokens.hash(hostToken),
      creationNonce: request.creationNonce,
      hostDeviceId: device.id,
      route: request.route,
    });
  } catch (error) {
    // A concurrent submit of the same form won the race (nonce is unique).
    const winner = await deps.plans.findIdByCreationNonce(request.creationNonce);
    if (winner !== undefined) return { kind: "duplicate", planId: winner };
    throw error;
  }
  return {
    kind: "created",
    planId: plan.id,
    title: plan.title,
    hostToken,
    newDeviceToken: newToken,
    deleteAt: plan.deleteAt,
    timeZone: plan.timeZone,
  };
}

/** Shared by every audience: whether responses are open and the public link preview. */
type Open = {
  responsesOpen: boolean;
  /** An active plan that has started: the public recap layer shows "took place" (spec 6 feature 5). */
  hasRecap: boolean;
  preview: PlanPreview;
};

export type ViewPlanResult =
  | { kind: "not_found" }
  | ({ kind: "viewer"; view: PlanViewForViewer } & Open)
  | ({ kind: "responder"; view: PlanViewForResponder } & Open)
  | ({ kind: "participant"; view: PlanViewForParticipant } & Open)
  | ({ kind: "poster"; view: PlanViewForPoster } & Open);

/** The plan as the requesting device may see it (spec 3.6). */
export async function viewPlan(
  deps: PlanDeps,
  request: {
    planId: string;
    deviceToken: string | undefined;
    /**
     * The plan page and the host's export show the host's rating result; calendar and route
     * downloads need not decrypt it (decision D20).
     */
    withRatingResult?: boolean;
  },
): Promise<ViewPlanResult> {
  const plan = await deps.plans.findById(request.planId);
  if (plan === undefined) return { kind: "not_found" };
  const now = deps.clock.now();
  const counts = await deps.responses.counts(plan.id);
  const shared: Open = {
    responsesOpen: canRespond(plan, now).ok,
    hasRecap: hasRecap(plan, now),
    preview: previewOf(plan),
  };
  const device = await resolveDevice(deps, request.deviceToken);
  const isHost =
    device !== undefined &&
    (await deps.devices.hasLink(device.id, { role: "host", planId: plan.id }));
  const own =
    device === undefined || isHost
      ? undefined
      : await deps.responses.findForDevice(plan.id, device.id);

  // The visibility matrix decides which read model an audience gets (spec 3.6).
  const audience = audienceFor(isHost ? "poster" : own);
  // Recap contributions are loaded only for audiences that may see them (spec 3.6).
  if (canSee(audience, "interestedNames")) {
    const responses = await deps.responses.listByPlan(plan.id);
    const contributions = await deps.recap.listByPlan(plan.id);
    // Notes are decrypted only where shown, and only once the result is due (decision D20).
    const ratings =
      request.withRatingResult === true &&
      canSee(audience, "ratingResult") &&
      ratingResultDue(plan, responses, now)
        ? await deps.ratings.listByPlan(plan.id)
        : undefined;
    return {
      kind: "poster",
      view: viewForPoster(plan, counts, responses, contributions, ratings, now),
      ...shared,
    };
  }
  if (own !== undefined && canSee(audience, "exactStartAndRoute")) {
    const responses = await deps.responses.listByPlan(plan.id);
    const contributions = canSee(audience, "recapContributions")
      ? await deps.recap.listByPlan(plan.id)
      : [];
    const ownRating = canSee(audience, "ownRating")
      ? await deps.ratings.findByResponse(own.id)
      : undefined;
    return {
      kind: "participant",
      view: viewForParticipant(plan, counts, own, now, responses, contributions, ownRating),
      ...shared,
    };
  }
  if (own !== undefined && canSee(audience, "ownResponseStatus")) {
    return { kind: "responder", view: viewForResponder(plan, counts, own, now), ...shared };
  }
  return { kind: "viewer", view: viewForViewer(plan, counts), ...shared };
}

/** The plan's colors for its theme stylesheet; public data (spec 3.1). */
export async function viewPlanTheme(
  deps: PlanDeps,
  request: { planId: string },
): Promise<{ kind: "found"; theme: PlanTheme } | { kind: "not_found" }> {
  const plan = await deps.plans.findById(request.planId);
  return plan === undefined
    ? { kind: "not_found" }
    : { kind: "found", theme: planTheme(plan.colors) };
}
