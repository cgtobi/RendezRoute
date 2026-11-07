// Audience-specific read models (spec 2a privacy boundary, 3.6). Each is built field by
// field, so forbidden fields are physically absent rather than hidden by templates.
import type { ActivityType } from "../domain/activity.ts";
import type { HexColor } from "../domain/color.ts";
import type { ExactStart, GeoPoint } from "../domain/geo.ts";
import type { PaceBand } from "../domain/pace.ts";
import type { DropPolicy, Plan, PlanStatus } from "../domain/plan.ts";

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
}

export interface PlanViewForPoster extends PlanViewForViewer {
  exactStart: ExactStart | undefined;
  retentionDays: number;
}

export function viewForViewer(plan: Plan): PlanViewForViewer {
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
  };
}

export function viewForPoster(plan: Plan): PlanViewForPoster {
  return { ...viewForViewer(plan), exactStart: plan.exactStart, retentionDays: plan.retentionDays };
}
