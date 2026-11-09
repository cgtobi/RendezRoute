import { describe, expect, it } from "vite-plus/test";
import { RESPONSE_KINDS } from "../../src/domain/response.ts";
import { AUDIENCES, audienceFor, canSee, PLAN_CONTENT } from "../../src/domain/visibility.ts";

// Spec 3.6, transcribed column by column. Removed people see exactly the Rejected column.
const expected = {
  publicDetails: [
    "viewer",
    "interested",
    "pending",
    "rejected",
    "removed",
    "accepted",
    "poster",
    "instanceAdmin",
  ],
  counts: [
    "viewer",
    "interested",
    "pending",
    "rejected",
    "removed",
    "accepted",
    "poster",
    "instanceAdmin",
  ],
  ownResponseStatus: ["interested", "pending", "rejected", "removed", "accepted"],
  interestedNames: ["poster"],
  participantNames: ["accepted", "poster"],
  exactStartAndRoute: ["accepted", "poster"],
  pendingRequests: ["poster"],
  recapSummary: [
    "viewer",
    "interested",
    "pending",
    "rejected",
    "removed",
    "accepted",
    "poster",
    "instanceAdmin",
  ],
  recapContributions: ["accepted", "poster"],
  ownRating: ["accepted"],
  ratingResult: ["poster"],
} as const;

describe("canSee (spec 3.6 What each audience sees)", () => {
  it("covers every content kind", () => {
    expect([...PLAN_CONTENT].sort()).toEqual(Object.keys(expected).sort());
  });

  for (const content of PLAN_CONTENT) {
    for (const audience of AUDIENCES) {
      const allowed = (expected[content] as readonly string[]).includes(audience);
      it(`${audience} ${allowed ? "sees" : "never sees"} ${content}`, () => {
        expect(canSee(audience, content)).toBe(allowed);
      });
    }
  }

  it("gives removed people exactly what rejected people see", () => {
    for (const content of PLAN_CONTENT)
      expect(canSee("removed", content)).toBe(canSee("rejected", content));
  });
});

describe("audienceFor", () => {
  it("maps response kinds to audiences", () => {
    expect(RESPONSE_KINDS.map((kind) => [kind, audienceFor({ kind })])).toEqual([
      ["interested", "interested"],
      ["requested", "pending"],
      ["rejected", "rejected"],
      ["joined", "accepted"],
      ["removed", "removed"],
    ]);
  });

  it("recognizes the poster and plain viewers", () => {
    expect(audienceFor("poster")).toBe("poster");
    expect(audienceFor(undefined)).toBe("viewer");
  });
});
