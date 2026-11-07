import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { respond } from "../../src/application/responses.ts";
import { removeRoute, routeForDownload, setRoute } from "../../src/application/routes.ts";
import type { Route } from "../../src/domain/route.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { brokenGpx, fakeGpx, FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;
const route: Route = {
  segments: [
    [
      { lat: 47.1, lng: 10.9, ele: 800 },
      { lat: 47.11, lng: 10.9, ele: 850 },
    ],
  ],
};
const noExactPoint = {
  ...sampleInput,
  exactLat: "",
  exactLng: "",
  distanceKm: "",
  elevationGainM: "",
};

beforeEach(() => {
  repos = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  deps = {
    ...repos,
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    routeParser: new FakeRouteParser(),
    limits: { horizonDays: 180, maxRetentionDays: 30 },
  };
});

/** `gpx: null` means no file; `undefined` would trigger the default. */
async function created(input = noExactPoint, gpx: Uint8Array | null = fakeGpx(route)) {
  const result = await createPlan(deps, {
    input,
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
    gpx: gpx ?? undefined,
  });
  if (result.kind !== "created") throw new Error(`expected created: ${JSON.stringify(result)}`);
  return result;
}

describe("createPlan with a GPX file (spec 5 feature 2, P8)", () => {
  it("stores the route and fills distance, elevation and the exact start from it", async () => {
    const { planId } = await created();
    const plan = await repos.plans.findById(planId);
    expect(plan).toMatchObject({ hasRoute: true, distanceMeters: 1112, elevationGainMeters: 50 });
    expect(plan?.exactStart?.point).toEqual({ lat: 47.1, lng: 10.9 });
    expect(plan?.area.point).toEqual({ lat: 47.1, lng: 10.9 });
    expect(await repos.plans.findRoute(planId)).toEqual(route);
  });

  it("keeps typed values", async () => {
    const { planId } = await created({ ...noExactPoint, distanceKm: "10" });
    expect(await repos.plans.findById(planId)).toMatchObject({ distanceMeters: 10_000 });
  });

  it("reports unusable files as a field error", async () => {
    const result = await createPlan(deps, {
      input: noExactPoint,
      units: "metric",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
      gpx: brokenGpx("route_unsafe"),
    });
    expect(result).toEqual({ kind: "invalid", errors: [{ field: "gpx", code: "route_unsafe" }] });
  });

  it("reports a route over 1,000 km at the file field, not at the distance field the poster left empty", async () => {
    const long: Route = {
      segments: [
        [
          { lat: 0, lng: 0 },
          { lat: 10, lng: 0 },
        ],
      ],
    };
    const result = await createPlan(deps, {
      input: noExactPoint,
      units: "metric",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
      gpx: fakeGpx(long),
    });
    expect(result).toEqual({ kind: "invalid", errors: [{ field: "gpx", code: "route_too_long" }] });
  });

  it("treats an empty upload as no route", async () => {
    const { planId } = await created(sampleInput, new Uint8Array());
    expect(await repos.plans.findById(planId)).toMatchObject({ hasRoute: false });
  });
});

describe("host route management (decision D10)", () => {
  it("sets a route on the host page, replacing distance and elevation", async () => {
    const plan = await created(sampleInput, null);
    const other: Route = {
      segments: [
        [
          { lat: 48, lng: 11, ele: 500 },
          { lat: 48.02, lng: 11, ele: 600 },
        ],
      ],
    };
    expect(
      await setRoute(deps, {
        planId: plan.planId,
        deviceToken: plan.newDeviceToken,
        gpx: fakeGpx(other),
      }),
    ).toEqual({ kind: "saved" });
    expect(await repos.plans.findById(plan.planId)).toMatchObject({
      hasRoute: true,
      distanceMeters: 2224,
      elevationGainMeters: 100,
    });
    expect((await repos.plans.findById(plan.planId))?.exactStart?.point).toEqual({
      lat: 48.16321,
      lng: 11.60147,
    });
  });

  it("removes a route", async () => {
    const plan = await created();
    expect(
      await removeRoute(deps, { planId: plan.planId, deviceToken: plan.newDeviceToken }),
    ).toEqual({ kind: "removed" });
    expect(await repos.plans.findRoute(plan.planId)).toBeUndefined();
  });

  it("is only for the host, and only before the start", async () => {
    const plan = await created();
    expect(
      await setRoute(deps, { planId: plan.planId, deviceToken: undefined, gpx: fakeGpx(route) }),
    ).toEqual({ kind: "forbidden" });
    clock.set("2026-06-07T06:00:00Z");
    expect(
      await setRoute(deps, {
        planId: plan.planId,
        deviceToken: plan.newDeviceToken,
        gpx: fakeGpx(route),
      }),
    ).toEqual({ kind: "not_allowed" });
    expect(
      await removeRoute(deps, { planId: plan.planId, deviceToken: plan.newDeviceToken }),
    ).toEqual({ kind: "not_allowed" });
  });

  it("reports unusable files", async () => {
    const plan = await created();
    expect(
      await setRoute(deps, {
        planId: plan.planId,
        deviceToken: plan.newDeviceToken,
        gpx: brokenGpx("route_too_large"),
      }),
    ).toEqual({
      kind: "invalid",
      code: "route_too_large",
    });
  });
});

describe("routeForDownload (spec 3.6: route only for participants and the host)", () => {
  it("gives the route to the host and to joined people only", async () => {
    const plan = await created();
    const join = async (choice: "joined" | "interested") => {
      const result = await respond(deps, {
        planId: plan.planId,
        choice,
        displayName: choice,
        language: "en",
        creationNonce: nonce(),
        deviceToken: undefined,
      });
      if (result.kind !== "created") throw new Error("respond failed");
      return result.newDeviceToken;
    };
    const joined = await join("joined");
    const interested = await join("interested");
    expect(
      await routeForDownload(deps, { planId: plan.planId, deviceToken: plan.newDeviceToken }),
    ).toEqual({
      kind: "found",
      title: "Easy Sunday run",
      route,
    });
    expect((await routeForDownload(deps, { planId: plan.planId, deviceToken: joined })).kind).toBe(
      "found",
    );
    for (const deviceToken of [interested, undefined]) {
      expect(await routeForDownload(deps, { planId: plan.planId, deviceToken })).toEqual({
        kind: "not_found",
      });
    }
  });

  it("reports plans without a route as not found", async () => {
    const plan = await created(sampleInput, null);
    expect(
      await routeForDownload(deps, { planId: plan.planId, deviceToken: plan.newDeviceToken }),
    ).toEqual({ kind: "not_found" });
  });
});
