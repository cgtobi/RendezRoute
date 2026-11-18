/** Supported activities (spec 3.1, decision D3). Changing this list requires a migration. */
export const ACTIVITY_TYPES = ["run", "trail", "hike", "ride", "gravel", "mtb"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export type PaceStyle = "pace" | "speed";

const STYLES: Readonly<Record<ActivityType, PaceStyle>> = {
  run: "pace",
  trail: "pace",
  hike: "pace",
  ride: "speed",
  gravel: "speed",
  mtb: "speed",
};

/** Runs and hikes show min:ss per distance, rides show speed. */
export function paceStyleFor(activity: ActivityType): PaceStyle {
  return STYLES[activity];
}
