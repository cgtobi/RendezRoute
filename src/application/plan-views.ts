// Audience-specific read models (spec 2a privacy boundary, 3.6). Each is built field by
// field, so forbidden fields are physically absent rather than hidden by templates.
import type { ActivityType } from "../domain/activity.ts";
import type { HexColor } from "../domain/color.ts";
import type { ExactStart, GeoPoint } from "../domain/geo.ts";
import type { PaceBand } from "../domain/pace.ts";
import type { DropPolicy, JoinMode, Plan, PlanStatus, Visibility } from "../domain/plan.ts";
import {
  canRate,
  type PlanRating,
  type RatingResult,
  ratingResult,
  ratingResultVisible,
  type RatingValue,
} from "../domain/rating.ts";
import {
  CONTRIBUTION_LIMITS,
  hasRecap,
  isRecapOpen,
  type RecapAuthor,
  type RecapContribution,
  recapClosesAt,
} from "../domain/recap.ts";
import { isNotAnswered } from "../domain/requests.ts";
import type { PlanResponse, ResponseKind } from "../domain/response.ts";

export interface Counts {
  interested: number;
  participants: number;
}

export interface PersonView {
  name: string;
  /** The poster, shown with a host badge (spec 3.5). */
  isHost: boolean;
}

export interface OwnResponseView {
  kind: ResponseKind;
  displayName: string;
  /** A request nobody decided before the start shows as "not answered" (spec 3.1). */
  notAnswered: boolean;
}

/** Everyone: public details and counts. */
export interface PlanViewForViewer {
  id: string;
  title: string;
  activity: ActivityType;
  posterName: string;
  startsAt: Date;
  timeZone: string;
  area: { label: string; point: GeoPoint | undefined };
  distanceMeters: number | undefined;
  elevationGainMeters: number | undefined;
  pace: PaceBand | undefined;
  dropPolicy: DropPolicy;
  /** Decides whether people join directly or request to join (spec 3.4). */
  joinMode: JoinMode;
  /** Who can find the plan (spec 3.3): the header names it when it is not link-only. */
  visibility: Visibility;
  note: string | undefined;
  colors: { primary: HexColor; secondary: HexColor };
  status: PlanStatus;
  deleteAt: Date;
  counts: Counts;
}

/**
 * What the instance admin sees of a plan (spec 3.6, Instance admin column): a few public fields,
 * named one by one, so a field added to the public view never reaches the admin unasked.
 */
export interface PlanViewForInstanceAdmin {
  id: string;
  title: string;
  activity: ActivityType;
  posterName: string;
  startsAt: Date;
  timeZone: string;
  areaLabel: string;
  status: PlanStatus;
  deleteAt: Date;
  counts: Counts;
}

/** Interested, pending, rejected and removed people: viewer content plus their own status. */
export interface PlanViewForResponder extends PlanViewForViewer {
  ownResponse: OwnResponseView;
}

/** One recap contribution as participants and the host see it (spec 6 feature 5). */
export interface ContributionView {
  id: string;
  authorName: string;
  byHost: boolean;
  body: string | undefined;
  linkUrl: string | undefined;
  /** Hidden by the host; only the host and the author see it (decision I42). */
  hidden: boolean;
  /** Written by the viewer, who may edit and delete it at any time. */
  own: boolean;
}

/** The private recap layer: participants and the host only (spec 3.6). */
export interface RecapView {
  open: boolean;
  closesAt: Date;
  /** Open, and the viewer is below the per-person limit. */
  canContribute: boolean;
  contributions: ContributionView[];
}

/** A participant's own rating of the plan (spec 6a); nobody else's is ever in a view. */
export interface RatingView {
  /** The recap is open: the rating can be given, changed or removed. */
  canRate: boolean;
  own: Pick<PlanRating, "value" | "note"> | undefined;
}

/** The host's view of the ratings (spec 6a): counts and signed notes, once due (decision D20). */
export interface RatingResultView extends RatingResult {
  notes: { authorName: string; value: RatingValue; note: string }[];
}

/** The participants, and the ratings that count: those of people still in (spec 3.5). */
export function countedRatings(
  ratings: readonly PlanRating[],
  responses: readonly PlanResponse[],
): { participants: PlanResponse[]; counted: PlanRating[] } {
  const participants = responses.filter((r) => r.kind === "joined");
  const ids = new Set(participants.map((r) => r.id));
  return { participants, counted: ratings.filter((rating) => ids.has(rating.responseId)) };
}

/** Whether the host's result is due: ratings closed, and at least 3 participants (D20). */
export function ratingResultDue(
  plan: Plan,
  responses: readonly PlanResponse[],
  now: Date,
): boolean {
  const participants = responses.filter((r) => r.kind === "joined").length;
  return ratingResultVisible(plan, participants, now);
}

/**
 * The result for the host, once due; `ratings` are undefined when not loaded. A stored tally
 * keeps the counts fixed; notes are signed, so they follow the people still in.
 */
export function ratingResultFor(
  plan: Plan,
  ratings: readonly PlanRating[] | undefined,
  responses: readonly PlanResponse[],
  now: Date,
): RatingResultView | undefined {
  if (ratings === undefined || !ratingResultDue(plan, responses, now)) return undefined;
  const { participants, counted } = countedRatings(ratings, responses);
  const names = new Map(participants.map((r) => [r.id, r.displayName]));
  return {
    ...(plan.ratingTally ??
      ratingResult(
        counted.map((rating) => rating.value),
        participants.length,
      )),
    notes: counted.flatMap((rating) =>
      rating.note === undefined
        ? []
        : [
            {
              authorName: names.get(rating.responseId) ?? "",
              value: rating.value,
              note: rating.note,
            },
          ],
    ),
  };
}

/** Accepted participants: plus exact start, participant names and the recap. */
export interface PlanViewForParticipant extends PlanViewForResponder {
  exactStart: ExactStart | undefined;
  /** Whether a route can be downloaded (spec 3.6: route only for participants and the poster). */
  hasRoute: boolean;
  participants: PersonView[];
  /** From the start on, for active plans. */
  recap: RecapView | undefined;
  /** From the start on, for active plans, like the recap. */
  rating: RatingView | undefined;
}

/** The poster: plus interested names. */
export interface PlanViewForPoster extends PlanViewForViewer {
  exactStart: ExactStart | undefined;
  hasRoute: boolean;
  participants: PersonView[];
  interested: PersonView[];
  /** Requests waiting for the host's decision (spec 3.6: the host only). */
  pendingRequests: number;
  retentionDays: number;
  recap: RecapView | undefined;
  /** Counts and signed notes, once due (spec 6a); the host only. */
  ratingResult: RatingResultView | undefined;
}

/**
 * Link previews: Open Graph tags and the card image (spec 3.3). Public fields only and the same
 * for every requester, so a preview fetcher can never see more than a viewer; never the exact
 * start or the route (spec 2b). The plan's language keeps cached images independent of who asks.
 */
export interface PlanPreview {
  id: string;
  title: string;
  activity: ActivityType;
  startsAt: Date;
  timeZone: string;
  areaLabel: string;
  areaPoint: GeoPoint | undefined;
  distanceMeters: number | undefined;
  pace: PaceBand | undefined;
  colors: { primary: HexColor; secondary: HexColor };
  status: PlanStatus;
  language: string;
  /** Changes whenever the plan or the card's look changes; versions the image URL and cache. */
  version: string;
}

/**
 * Raised when the preview card's look changes (3: the tinted title block, decision D30), so cached
 * cards are drawn again and chat apps fetch the new image.
 */
const PREVIEW_LOOK = 3;

export function previewOf(plan: Plan): PlanPreview {
  return {
    id: plan.id,
    title: plan.title,
    activity: plan.activity,
    startsAt: plan.startsAt,
    timeZone: plan.timeZone,
    areaLabel: plan.area.label,
    areaPoint: plan.area.point,
    distanceMeters: plan.distanceMeters,
    pace: plan.pace,
    colors: { primary: plan.colors.primary, secondary: plan.colors.secondary },
    status: plan.status,
    language: plan.posterLanguage,
    // Letters and digits only, e.g. "l3mwb7l1fu": the look, then the plan's last change.
    version: `l${PREVIEW_LOOK}${plan.updatedAt.getTime().toString(36)}`,
  };
}

export function viewForViewer(plan: Plan, counts: Counts): PlanViewForViewer {
  return {
    id: plan.id,
    title: plan.title,
    activity: plan.activity,
    posterName: plan.posterName,
    startsAt: plan.startsAt,
    timeZone: plan.timeZone,
    area: { label: plan.area.label, point: plan.area.point },
    distanceMeters: plan.distanceMeters,
    elevationGainMeters: plan.elevationGainMeters,
    pace: plan.pace,
    dropPolicy: plan.dropPolicy,
    joinMode: plan.joinMode,
    visibility: plan.visibility,
    note: plan.note,
    colors: plan.colors,
    status: plan.status,
    deleteAt: plan.deleteAt,
    counts: { interested: counts.interested, participants: counts.participants },
  };
}

export const ownResponse = (response: PlanResponse, plan: Plan, now: Date): OwnResponseView => ({
  kind: response.kind,
  displayName: response.displayName,
  notAnswered: isNotAnswered(response, plan, now),
});

/** Host first, then joined people in response order. */
function participantsOf(plan: Plan, responses: readonly PlanResponse[]): PersonView[] {
  return [
    { name: plan.posterName, isHost: true },
    ...responses
      .filter((r) => r.kind === "joined")
      .map((r) => ({ name: r.displayName, isHost: false })),
  ];
}

export function viewForResponder(
  plan: Plan,
  counts: Counts,
  response: PlanResponse,
  now: Date,
): PlanViewForResponder {
  return { ...viewForViewer(plan, counts), ownResponse: ownResponse(response, plan, now) };
}

/**
 * The recap for a participant or the host, from the start on, for active plans. The host sees
 * every contribution; participants see those not hidden, and their own (decision I42).
 */
export function recapViewFor(
  plan: Plan,
  contributions: readonly RecapContribution[],
  responses: readonly PlanResponse[],
  viewer: RecapAuthor,
  now: Date,
): RecapView | undefined {
  if (!hasRecap(plan, now)) return undefined;
  const ownResponseId = viewer.kind === "participant" ? viewer.responseId : undefined;
  const isOwn = (c: RecapContribution) => c.responseId === ownResponseId;
  const names = new Map(responses.map((r) => [r.id, r.displayName]));
  const open = isRecapOpen(plan, now);
  return {
    open,
    closesAt: recapClosesAt(plan),
    canContribute: open && contributions.filter(isOwn).length < CONTRIBUTION_LIMITS.perPerson,
    contributions: contributions
      .filter((c) => viewer.kind === "host" || !c.hiddenByHost || isOwn(c))
      .flatMap((c): ContributionView[] => {
        const authorName = c.responseId === undefined ? plan.posterName : names.get(c.responseId);
        if (authorName === undefined) return [];
        return [
          {
            id: c.id,
            authorName,
            byHost: c.responseId === undefined,
            body: c.body,
            linkUrl: c.linkUrl,
            hidden: c.hiddenByHost,
            own: isOwn(c),
          },
        ];
      }),
  };
}

export function viewForParticipant(
  plan: Plan,
  counts: Counts,
  response: PlanResponse,
  now: Date,
  responses: readonly PlanResponse[],
  contributions: readonly RecapContribution[],
  ownRating: PlanRating | undefined,
): PlanViewForParticipant {
  return {
    ...viewForResponder(plan, counts, response, now),
    exactStart: plan.exactStart,
    hasRoute: plan.hasRoute,
    participants: participantsOf(plan, responses),
    recap: recapViewFor(
      plan,
      contributions,
      responses,
      { kind: "participant", responseId: response.id },
      now,
    ),
    rating: hasRecap(plan, now)
      ? {
          canRate: canRate(plan, response.kind, now).ok,
          own:
            ownRating === undefined ? undefined : { value: ownRating.value, note: ownRating.note },
        }
      : undefined,
  };
}

export function viewForPoster(
  plan: Plan,
  counts: Counts,
  responses: readonly PlanResponse[],
  contributions: readonly RecapContribution[],
  /** Undefined unless loaded for the plan page (decision D20: decrypted only where shown). */
  ratings: readonly PlanRating[] | undefined,
  now: Date,
): PlanViewForPoster {
  return {
    ...viewForViewer(plan, counts),
    exactStart: plan.exactStart,
    hasRoute: plan.hasRoute,
    participants: participantsOf(plan, responses),
    interested: responses
      .filter((r) => r.kind === "interested")
      .map((r) => ({ name: r.displayName, isHost: false })),
    pendingRequests: responses.filter((r) => r.kind === "requested").length,
    retentionDays: plan.retentionDays,
    recap: recapViewFor(plan, contributions, responses, { kind: "host" }, now),
    ratingResult: ratingResultFor(plan, ratings, responses, now),
  };
}
