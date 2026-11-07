// What each audience may see (spec 3.6). Read models are built from this matrix;
// privacy tests check every endpoint against it.
import type { ResponseKind } from "./response.ts";

export const AUDIENCES = [
  "viewer",
  "interested",
  "pending",
  "rejected",
  "removed",
  "accepted",
  "poster",
  "instanceAdmin",
] as const;
export type Audience = (typeof AUDIENCES)[number];

export const PLAN_CONTENT = [
  "publicDetails",
  "counts",
  "ownResponseStatus",
  "interestedNames",
  "participantNames",
  "exactStartAndRoute",
  "pendingRequests",
  "recapSummary",
  "recapContributions",
] as const;
export type PlanContent = (typeof PLAN_CONTENT)[number];

const everyone: readonly Audience[] = AUDIENCES;
const responders: readonly Audience[] = [
  "interested",
  "pending",
  "rejected",
  "removed",
  "accepted",
];

const MATRIX: Readonly<Record<PlanContent, ReadonlySet<Audience>>> = {
  publicDetails: new Set(everyone),
  counts: new Set(everyone),
  ownResponseStatus: new Set(responders),
  interestedNames: new Set(["poster"]),
  participantNames: new Set(["accepted", "poster"]),
  exactStartAndRoute: new Set(["accepted", "poster"]),
  pendingRequests: new Set(["poster"]),
  recapSummary: new Set(everyone),
  // Instance admins see contributions only as attached to a report by the reporter, never via plan views.
  recapContributions: new Set(["accepted", "poster"]),
};

export function canSee(audience: Audience, content: PlanContent): boolean {
  return MATRIX[content].has(audience);
}

const BY_KIND: Readonly<Record<ResponseKind, Audience>> = {
  interested: "interested",
  requested: "pending",
  rejected: "rejected",
  joined: "accepted",
  removed: "removed",
};

/** The audience of someone who is the poster, has a response, or is a plain viewer. */
export function audienceFor(role: "poster" | { kind: ResponseKind } | undefined): Audience {
  if (role === undefined) return "viewer";
  if (role === "poster") return "poster";
  return BY_KIND[role.kind];
}
