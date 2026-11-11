// Nearby (spec 7 Visibility and Nearby plans; decisions D35, I59): public plans near a place the
// viewer typed or chose, with public fields only.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { findNearby, locateNearbyPlace } from "../../src/application/nearby.ts";
import type { PlanDeps } from "../../src/application/plans.ts";
import { type NearbyInput, nearbyInput } from "../../src/domain/nearby.ts";
import type { Plan } from "../../src/domain/plan.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakeGeocoder } from "../fakes/geocoder.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { fixtureNow, samplePlan } from "../fixtures/plans.ts";

let deps: Pick<PlanDeps, "plans" | "clock" | "limits">;
let geocoder: FakeGeocoder;
let n = 0;

beforeEach(() => {
  const repos = createFakeRepositories();
  deps = {
    plans: repos.plans,
    clock: new FakeClock(fixtureNow),
    limits: { horizonDays: 180, maxRetentionDays: 30 },
  };
  geocoder = new FakeGeocoder({
    Flaucher: [{ label: "Flaucher, Munich", lat: 48.1132, lng: 11.5578 }],
  });
});

async function add(overrides: Partial<Plan>) {
  const plan = samplePlan({
    id: `plan-${++n}`,
    visibility: "public",
    startsAt: new Date("2026-06-07T05:30:00Z"),
    ...overrides,
  });
  await deps.plans.create({
    plan,
    hostTokenHash: `host-${n}`,
    creationNonce: `nonce-${n}`,
    hostDeviceId: "device-1",
  });
  return plan;
}

const search = (fields: Partial<NearbyInput>, center = { lat: 48.16, lng: 11.6 }) =>
  findNearby(deps, {
    center,
    input: { ...nearbyInput(), ...fields },
    units: "metric",
    timeZone: "Europe/Berlin",
  });

const locate = (place: string, withGeocoder: FakeGeocoder | undefined = geocoder) =>
  locateNearbyPlace(withGeocoder, { place, language: "de" });

describe("searching Nearby (decision D35)", () => {
  it("lists matching public plans with public fields only, the nearest distance rounded", async () => {
    const plan = await add({ title: "Hill repeats" });
    await add({ visibility: "link", title: "Link only" });
    // At the snapped point of the sample plan's exact start (48.16, 11.60).
    const result = await search({});
    expect(result).toEqual({
      kind: "results",
      truncated: false,
      items: [
        {
          planId: plan.id,
          title: "Hill repeats",
          activity: "run",
          startsAt: plan.startsAt,
          timeZone: "Europe/Berlin",
          areaLabel: plan.area.label,
          distanceMeters: plan.distanceMeters,
          elevationGainMeters: plan.elevationGainMeters,
          pace: plan.pace,
          awayKm: 0,
        },
      ],
    });
    // Nothing private: no exact start, route, note or names.
    expect(JSON.stringify(result)).not.toContain("North gate");
    expect(JSON.stringify(result)).not.toContain("Bring water");
  });

  it("puts a typed place on the viewer's grid", async () => {
    // Flaucher at 48.1132, 11.5578 → 48.12, 11.56.
    expect(await locate("Flaucher")).toEqual({ kind: "point", point: { lat: 48.12, lng: 11.56 } });
    expect(geocoder.calls).toEqual([{ query: "Flaucher", language: "de" }]);
  });

  it("says when a typed place is not found, cannot be looked up, or is not one", async () => {
    expect(await locate("Atlantis")).toEqual({ kind: "place_not_found" });
    expect(await locate("x")).toEqual({
      kind: "invalid",
      errors: [{ field: "place", code: "place_invalid" }],
    });
    geocoder.failing = true;
    expect(await locate("Flaucher")).toEqual({ kind: "place_unavailable" });
    expect(await locate("Flaucher", undefined)).toEqual({ kind: "place_unavailable" });
  });

  it("reports filters it cannot read", async () => {
    expect(await search({ radius: "7" })).toEqual({
      kind: "invalid",
      errors: [{ field: "radius", code: "choice_invalid" }],
    });
  });

  it("sorts by start and leaves out what is too far, too late or past", async () => {
    const later = await add({ startsAt: new Date("2026-06-09T05:30:00Z") });
    const sooner = await add({ startsAt: new Date("2026-06-08T05:30:00Z") });
    await add({ startsAt: new Date("2026-07-01T05:30:00Z") });
    await add({
      area: { label: "Augsburg", point: { lat: 48.37, lng: 10.9 } },
      exactStart: undefined,
    });
    await add({ startsAt: new Date(fixtureNow.getTime() - 60_000) });
    const result = await search({ from: "2026-06-08" });
    expect(result.kind === "results" && result.items.map((item) => item.planId)).toEqual([
      sooner.id,
      later.id,
    ]);
  });

  it("finds matches beyond the first page of candidates, and lists 50 of them", async () => {
    // 450 runs first, then 60 rides: the rides lie beyond two pages of candidates.
    for (let i = 0; i < 450; i++) {
      await add({ startsAt: new Date(Date.parse("2026-06-02T05:00:00Z") + i * 60_000) });
    }
    for (let i = 0; i < 60; i++) {
      await add({
        activity: "ride",
        pace: undefined,
        startsAt: new Date(Date.parse("2026-06-05T05:00:00Z") + i * 60_000),
      });
    }
    const rides = await search({ activity: "ride" });
    expect(rides.kind === "results" && [rides.items.length, rides.truncated]).toEqual([50, true]);
    // Filters the database cannot apply: distance among 450 runs and 60 rides.
    await add({
      distanceMeters: 42_195,
      startsAt: new Date("2026-06-12T05:00:00Z"),
      title: "Marathon",
    });
    const far = await search({ distanceFrom: "40" });
    expect(far.kind === "results" && far.items.map((item) => item.title)).toEqual(["Marathon"]);
  });
});
