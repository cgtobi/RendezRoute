import type { Plan } from "../../src/domain/plan.ts";
import { type PlanInput, validatePlanInput } from "../../src/domain/plan-input.ts";

export const fixtureNow = new Date("2026-06-01T08:00:00Z");

export const sampleInput: PlanInput = {
  posterName: "Anna",
  activity: "run",
  title: "Easy Sunday run",
  note: "Bring water.",
  date: "2026-06-07",
  time: "07:30",
  timeZone: "Europe/Berlin",
  areaLabel: "Englischer Garten, north end",
  areaLat: "",
  areaLng: "",
  exactDescription: "North gate, by the bike racks",
  exactLat: "48.16321",
  exactLng: "11.60147",
  distanceKm: "12.5",
  elevationGainM: "",
  paceFrom: "5:30",
  paceTo: "6:00",
  dropPolicy: "no_drop",
  joinMode: "open",
  primaryColor: "#2E5BFF",
  secondaryColor: "#FF7A45",
  retentionDays: "",
  recapWindow: "",
  keepAsTemplate: "",
  templateIncludePrivate: "",
};

export function samplePlan(overrides: Partial<Plan> = {}, input: Partial<PlanInput> = {}): Plan {
  const draft = validatePlanInput(
    { ...sampleInput, ...input },
    { now: fixtureNow, horizonDays: 180, maxRetentionDays: 30 },
    "metric",
  );
  if (!draft.ok) throw new Error(JSON.stringify(draft.errors));
  return {
    ...draft.value,
    id: "plan-0001",
    posterLanguage: "en",
    visibility: "link",
    joinMode: "open",
    status: "active",
    hasRoute: false,
    recapWindowSetAt: undefined,
    recapClosedAt: undefined,
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
    ...overrides,
  };
}
