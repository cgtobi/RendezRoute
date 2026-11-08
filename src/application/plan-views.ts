// Audience-specific read models (spec 2a privacy boundary, 3.6). Each is built field by
// field, so forbidden fields are physically absent rather than hidden by templates.
import type { ActivityType } from "../domain/activity.ts";
import type { HexColor } from "../domain/color.ts";
import type { ExactStart, GeoPoint } from "../domain/geo.ts";
import type { PaceBand } from "../domain/pace.ts";
import type { DropPolicy, Plan, PlanStatus } from "../domain/plan.ts";
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
  note: string | undefined;
  colors: { primary: HexColor; secondary: HexColor };
  status: PlanStatus;
  deleteAt: Date;
  counts: Counts;
}

/** Interested, pending, rejected and removed people: viewer content plus their own status. */
export interface PlanViewForResponder extends PlanViewForViewer {
  ownResponse: OwnResponseView;
}

/** Accepted participants: plus exact start and participant names. */
export interface PlanViewForParticipant extends PlanViewForResponder {
  exactStart: ExactStart | undefined;
  /** Whether a route can be downloaded (spec 3.6: route only for participants and the poster). */
  hasRoute: boolean;
  participants: PersonView[];
}

/** The poster: plus interested names. */
export interface PlanViewForPoster extends PlanViewForViewer {
  exactStart: ExactStart | undefined;
  hasRoute: boolean;
  participants: PersonView[];
  interested: PersonView[];
  retentionDays: number;
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
  /** Changes whenever the plan changes; versions the image URL and cache. */
  version: string;
}

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
    version: plan.updatedAt.getTime().toString(36),
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
    note: plan.note,
    colors: plan.colors,
    status: plan.status,
    deleteAt: plan.deleteAt,
    counts: { interested: counts.interested, participants: counts.participants },
  };
}

const ownResponse = (response: PlanResponse): OwnResponseView => ({
  kind: response.kind,
  displayName: response.displayName,
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
): PlanViewForResponder {
  return { ...viewForViewer(plan, counts), ownResponse: ownResponse(response) };
}

export function viewForParticipant(
  plan: Plan,
  counts: Counts,
  response: PlanResponse,
  responses: readonly PlanResponse[],
): PlanViewForParticipant {
  return {
    ...viewForResponder(plan, counts, response),
    exactStart: plan.exactStart,
    hasRoute: plan.hasRoute,
    participants: participantsOf(plan, responses),
  };
}

export function viewForPoster(
  plan: Plan,
  counts: Counts,
  responses: readonly PlanResponse[],
): PlanViewForPoster {
  return {
    ...viewForViewer(plan, counts),
    exactStart: plan.exactStart,
    hasRoute: plan.hasRoute,
    participants: participantsOf(plan, responses),
    interested: responses
      .filter((r) => r.kind === "interested")
      .map((r) => ({ name: r.displayName, isHost: false })),
    retentionDays: plan.retentionDays,
  };
}
