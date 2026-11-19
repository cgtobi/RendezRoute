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
import type { PostingMode } from "../domain/invite.ts";
import type { GeoPoint } from "../domain/geo.ts";
import type { ShareButton } from "../domain/plan.ts";
import { hasRecap, shortenedRecapWindow } from "../domain/recap.ts";
import type { RecapWindow } from "../domain/schedule.ts";
import { audienceFor, canSee } from "../domain/visibility.ts";
import {
  federatedAtFor,
  type VisibilityChoices,
  visibilityChoices,
  visibilityRefused,
} from "./public-plans.ts";
import { planActor } from "./attribution.ts";
import { syncPublication } from "./publishing.ts";
import {
  applyRouteDefaults,
  parseRouteTrim,
  type Route,
  routeStats,
  routeToKeep,
} from "../domain/route.ts";
import { canRespond } from "../domain/responding.ts";
import { type DeviceDeps, ensureDevice, resolveDevice } from "./devices.ts";
import { type PostingNeed, postingNeed } from "./posting-rules.ts";
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
  AccessScope,
  CalendarFeedRepository,
  ChannelLinks,
  EmailOutbox,
  NtfyOutbox,
  TelegramOutbox,
  FediverseDmOutbox,
  RemoteActorLookup,
  ChannelRepository,
  FormNonceRepository,
  InviteRepository,
  PermissionRepository,
  RatingRepository,
  ReportRepository,
  JobQueue,
  PlanRepository,
  RecapRepository,
  ResponseRepository,
  RouteParseError,
  RouteParser,
  SentReminderRepository,
  TemplateRepository,
  ActorKeyFactory,
  FederationPublisher,
  FediverseProfileRepository,
  FollowerRepository,
  ContributionNoteRepository,
  ParticipantNoteRepository,
  PublicationRepository,
  RemoteContributionRepository,
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
  /** Reports to the instance admin (spec 7 Moderation). */
  reports: ReportRepository;
  /** Who may create plans, and the invite links and permissions behind it (spec 7 Moderation). */
  postingMode: PostingMode;
  /**
   * PUBLIC_REQUIRES_LOGIN (spec 7 Visibility and Nearby plans): public plans only for accounts.
   * Absent means true, the stricter rule.
   */
  publicRequiresLogin?: boolean | undefined;
  /**
   * Whether public may be chosen at all: in 0.8 a public plan is only listed in Nearby, so not
   * while it is off (decision I59). Absent means true.
   */
  publicPlansOffered?: boolean | undefined;
  /**
   * Poster actors (spec 7 ActivityPub, decisions D36, D37). The profiles are always there, so an
   * account can be deleted after federation was turned off; `enabled` while FEDERATION_ENABLED.
   */
  posterActors?:
    | {
        profiles: FediverseProfileRepository;
        actorKeys: ActorKeyFactory;
        /** Who follows the instance's actors (decision D38). */
        followers: FollowerRepository;
        /** Which plans were sent to the fediverse, by whom and to whom (D38, D39). */
        publications: PublicationRepository;
        /** Private Notes with the exact start and route, sent to remote participants (D43). */
        notes: ParticipantNoteRepository;
        /** Recap contributions sent as Notes, and replies received as contributions (D44). */
        contributionNotes: ContributionNoteRepository;
        remoteContributions: RemoteContributionRepository;
        /** Undefined while federation is off: nothing is sent. */
        publisher: FederationPublisher | undefined;
        enabled: boolean;
      }
    | undefined;
  invites: InviteRepository;
  permissions: PermissionRepository;
  /** Notification channels, the job queue that delivers to them and sent reminders (spec 6 feature 3). */
  notify?:
    | {
        channels: ChannelRepository;
        jobs: JobQueue;
        reminders: SentReminderRepository;
        /**
         * The secret in confirmable channels' links (decisions D31, D33). Links always work, so
         * stored channels can be turned off also after their service is switched off.
         */
        links?: ChannelLinks | undefined;
        /** The outbox exists only while SMTP is configured. */
        email?: { outbox: EmailOutbox | undefined; reportAlerts: boolean } | undefined;
        /** Present while NTFY_URL is configured (decision D33). */
        ntfy?: { outbox: NtfyOutbox; server: URL } | undefined;
        /**
         * Present while TELEGRAM_BOT_TOKEN is configured (decision D34); the bot's name comes from
         * Telegram and is undefined until the bot could be reached.
         */
        telegram?: { outbox: TelegramOutbox; botName: () => string | undefined } | undefined;
        /**
         * Present while federation is on (decision D47): account notices as direct messages to
         * the fediverse login's address, which `lookup` finds by WebFinger when one is sent.
         */
        fediverseMessages?: { outbox: FediverseDmOutbox; lookup: RemoteActorLookup } | undefined;
      }
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
  | { kind: "bad_request" }
  /** The posting rules do not let this device create plans (spec 7 Moderation). */
  | { kind: "not_allowed"; needs: PostingNeed };

/**
 * Parses an upload, cuts it to the meeting point where the plan has one with coordinates (D40)
 * and hides its other ends as chosen (D13); what is cut or hidden is never stored.
 */
export function readRoute(
  deps: Pick<PlanDeps, "routeParser">,
  gpx: Uint8Array,
  {
    routeTrim,
    meetingPoint,
  }: { routeTrim: string | undefined; meetingPoint: GeoPoint | undefined },
): Result<Route, RouteParseError | "route_trimmed_away" | "choice_invalid"> {
  const trim = parseRouteTrim(routeTrim ?? "");
  if (!trim.ok) return trim;
  const parsed = deps.routeParser.parse(gpx);
  return parsed.ok ? routeToKeep(parsed.value, { trimMeters: trim.value, meetingPoint }) : parsed;
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
  const needs = await postingNeed(deps, request);
  if (needs !== undefined) return { kind: "not_allowed", needs };

  const now = deps.clock.now();
  const rules = { now, ...deps.limits };
  let input = request.input;
  let route: Route | undefined;
  if (request.gpx !== undefined && request.gpx.byteLength > 0) {
    // The form first: parsing a large file is the costly part, and filling empty fields from
    // the route can add errors but never remove them.
    const typed = validatePlanInput(input, rules, request.units);
    if (!typed.ok) return { kind: "invalid", errors: typed.errors };
    const parsed = readRoute(deps, request.gpx, {
      routeTrim: request.routeTrim,
      meetingPoint: typed.value.exactStart?.point,
    });
    if (!parsed.ok) return { kind: "invalid", errors: [{ field: "gpx", code: parsed.error }] };
    route = parsed.value;
    input = applyRouteDefaults(input, routeStats(route), {
      units: request.units,
      replace: { distance: false, elevation: false },
    });
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

  // The plan belongs to the device's account, whose profile would share it (decision D35).
  const choices = await visibilityChoices(deps, { deviceToken: request.deviceToken });
  const refused = visibilityRefused(draft.value.visibility, choices);
  if (refused !== undefined) return { kind: "invalid", errors: refused };

  const stored = await storeNewPlan(deps, draft.value, { ...request, route, choices });
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
  /** For the share buttons on the links page, as the host chose them (decision D41). */
  shareButtons: readonly ShareButton[];
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
    /** What the device's account may choose, which the draft was checked against. */
    choices: VisibilityChoices;
  },
): Promise<CreatedPlan | { kind: "duplicate"; planId: string }> {
  const now = deps.clock.now();
  const hostToken = deps.tokens.generate();
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  const plan: Plan = {
    ...draft,
    id: deps.ids.planId(),
    posterLanguage: request.language,
    status: "active",
    hasRoute: request.route !== undefined,
    recapWindowSetAt: undefined,
    recapClosedAt: undefined,
    federatedAt: federatedAtFor(draft.visibility, request.choices, undefined, now),
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
      // Logged in: the plan belongs to the account (step 5a).
      ownerIdentityId: device.identityId,
      route: request.route,
    });
  } catch (error) {
    // A concurrent submit of the same form won the race (nonce is unique).
    const winner = await deps.plans.findIdByCreationNonce(request.creationNonce);
    if (winner !== undefined) return { kind: "duplicate", planId: winner };
    throw error;
  }
  // To the owner's followers, if its profile shares it (D38).
  await syncPublication(deps, undefined, plan);
  return {
    kind: "created",
    planId: plan.id,
    title: plan.title,
    hostToken,
    newDeviceToken: newToken,
    deleteAt: plan.deleteAt,
    timeZone: plan.timeZone,
    shareButtons: plan.shareButtons,
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
    /** Whose eyes: the browser's own, its account's, or both (the default; I52 exports). */
    scope?: AccessScope;
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
    (await deps.devices.hasLink(device.id, { role: "host", planId: plan.id }, request.scope));
  const own =
    device === undefined || isHost
      ? undefined
      : await deps.responses.findForDevice(plan.id, device.id, request.scope);

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

/**
 * Whether the fediverse gets this plan from an owner's active profile: a followers or public
 * plan, not withdrawn from the fediverse (D39). Only the plan page asks.
 */
export async function isSharedByActor(deps: PlanDeps, planId: string): Promise<boolean> {
  const plan = await deps.plans.findById(planId);
  if (plan === undefined || plan.visibility === "link") return false;
  if (deps.posterActors?.enabled !== true || plan.federatedAt === undefined) return false;
  if ((await deps.posterActors.publications.find(plan.id))?.kind === "withdrawn") return false;
  return (await planActor(deps, plan)) !== undefined;
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
