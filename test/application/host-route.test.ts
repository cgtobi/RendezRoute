// A route chosen in the host edit form is saved with the edit, all or nothing (decision D10).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { editPlan } from "../../src/application/host.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { respond } from "../../src/application/responses.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import type { PlanInput } from "../../src/domain/plan-input.ts";
import type { Route } from "../../src/domain/route.ts";
import type { Units } from "../../src/domain/units.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { brokenGpx, fakeGpx, FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let parses: number;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

/** 11 points about 111 m apart heading north, climbing 10 m each. */
const north: Route = {
  segments: [
    Array.from({ length: 11 }, (_, i) => ({
      lat: Number((47.1 + i * 0.001).toFixed(3)),
      lng: 10.9,
      ele: 500 + i * 10,
    })),
  ],
};
const old: Route = {
  segments: [
    [
      { lat: 46.5, lng: 9.5 },
      { lat: 46.6, lng: 9.6 },
    ],
  ],
};

beforeEach(() => {
  repos = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  parses = 0;
  const parser = new FakeRouteParser();
  deps = {
    ...repos,
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    routeParser: {
      parse: (file) => {
        parses++;
        return parser.parse(file);
      },
    },
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
  };
});

async function created(
  input: Partial<PlanInput> = {},
  { units = "metric", gpx }: { units?: Units; gpx?: Uint8Array } = {},
) {
  const result = await createPlan(deps, {
    input: { ...sampleInput, ...input },
    units,
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
    gpx,
  });
  if (result.kind !== "created") throw new Error(`expected created: ${JSON.stringify(result)}`);
  parses = 0;
  return { planId: result.planId, host: result.newDeviceToken };
}

const stored = async (planId: string) => {
  const plan = await repos.plans.findById(planId);
  if (plan === undefined) throw new Error("missing plan");
  return plan;
};

/** The edit form as shown, with changes, and a file. */
async function save(
  { planId, host }: { planId: string; host: string | undefined },
  changes: Partial<PlanInput>,
  gpx: Uint8Array | undefined,
  {
    units = "metric",
    trim = "",
    confirmAcceptPending,
  }: {
    units?: Units;
    trim?: string;
    confirmAcceptPending?: number;
  } = {},
) {
  return editPlan(deps, {
    planId,
    deviceToken: host,
    input: { ...planToInput(await stored(planId), units), ...changes },
    units,
    confirmDeleteNow: false,
    confirmAcceptPending,
    route: gpx === undefined ? undefined : { gpx, trim },
  });
}

describe("editPlan with a route (decision D10)", () => {
  it("stores the edit and the route together", async () => {
    const plan = await created();
    clock.set("2026-06-02T08:00:00Z");
    expect(await save(plan, { title: "Renamed" }, fakeGpx(north))).toMatchObject({
      kind: "updated",
    });
    expect(await stored(plan.planId)).toMatchObject({
      title: "Renamed",
      hasRoute: true,
      distanceMeters: 1112,
      elevationGainMeters: 100,
      updatedAt: new Date("2026-06-02T08:00:00Z"),
    });
    expect(await repos.plans.findRoute(plan.planId)).toEqual(north);
  });

  it("cuts the route at the meeting point submitted in the same save (D40)", async () => {
    const plan = await created();
    const result = await save(plan, { exactLat: "47.105", exactLng: "10.9" }, fakeGpx(north));
    expect(result).toMatchObject({ kind: "updated" });
    const route = await repos.plans.findRoute(plan.planId);
    expect(route?.segments[0]?.[0]).toEqual({ lat: 47.105, lng: 10.9, ele: 550 });
    expect((await stored(plan.planId)).exactStart?.point).toEqual({ lat: 47.105, lng: 10.9 });
  });

  it("takes the exact start from the route when the plan has none", async () => {
    const plan = await created({ exactDescription: "", exactLat: "", exactLng: "" });
    await save(plan, {}, fakeGpx(north));
    expect((await stored(plan.planId)).exactStart?.point).toEqual({ lat: 47.1, lng: 10.9 });
  });

  it("saves nothing when the file cannot be used", async () => {
    const plan = await created({}, { gpx: fakeGpx(old) });
    const before = await stored(plan.planId);
    clock.set("2026-06-02T08:00:00Z");
    for (const [gpx, trim, code] of [
      [brokenGpx("route_unreadable"), "", "route_unreadable"],
      [fakeGpx(north), "1000", "route_trimmed_away"],
      [fakeGpx(north), "300", "choice_invalid"],
    ] as const) {
      expect(await save(plan, { title: "Renamed" }, gpx, { trim })).toEqual({
        kind: "invalid",
        errors: [{ field: "gpx", code }],
      });
    }
    expect(await stored(plan.planId)).toEqual(before);
    expect(await repos.plans.findRoute(plan.planId)).toEqual(old);
  });

  it("reports a route over 1,000 km at the file field, and saves nothing", async () => {
    const plan = await created();
    const long: Route = {
      segments: [
        [
          { lat: 0, lng: 0 },
          { lat: 10, lng: 0 },
        ],
      ],
    };
    const before = await stored(plan.planId);
    expect(
      await save(plan, { exactLat: "", exactLng: "", exactDescription: "" }, fakeGpx(long)),
    ).toEqual({
      kind: "invalid",
      errors: [{ field: "gpx", code: "route_too_long" }],
    });
    expect(await stored(plan.planId)).toEqual(before);
  });

  it("checks the form first: errors in it, the visibility or the name never cost a parse", async () => {
    const plan = await created({ joinMode: "approval" });
    const ben = await respond(deps, {
      planId: plan.planId,
      choice: "requested",
      displayName: "Ben",
      requestNote: "",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    expect(ben.kind).toBe("created");
    const before = await stored(plan.planId);
    expect(await save(plan, { title: "" }, fakeGpx(north))).toEqual({
      kind: "invalid",
      errors: [{ field: "title", code: "required" }],
    });
    expect(await save(plan, { visibility: "public" }, fakeGpx(north))).toEqual({
      kind: "invalid",
      errors: [{ field: "visibility", code: "public_needs_login" }],
    });
    expect(await save(plan, { posterName: "Ben" }, fakeGpx(north))).toEqual({
      kind: "invalid",
      errors: [{ field: "posterName", code: "name_taken_by_response" }],
    });
    // Accepting pending requests is asked first; the file comes with the confirmed save.
    expect(await save(plan, { joinMode: "open" }, fakeGpx(north))).toEqual({
      kind: "confirm_accept_pending",
      count: 1,
    });
    expect(parses).toBe(0);
    expect(await stored(plan.planId)).toEqual(before);
    expect(await repos.plans.findRoute(plan.planId)).toBeUndefined();
  });

  it("refuses a file after the start, and does not save the retention edit without it", async () => {
    const plan = await created();
    clock.set("2026-06-07T06:00:00Z");
    const before = await stored(plan.planId);
    expect(await save(plan, { retentionDays: "3" }, fakeGpx(north))).toEqual({
      kind: "not_allowed",
    });
    expect(parses).toBe(0);
    expect(await stored(plan.planId)).toEqual(before);
    expect(await repos.plans.findRoute(plan.planId)).toBeUndefined();
  });

  it("treats an empty file as none", async () => {
    const plan = await created();
    expect(await save(plan, { title: "Renamed" }, new Uint8Array())).toMatchObject({
      kind: "updated",
    });
    expect(parses).toBe(0);
    expect(await stored(plan.planId)).toMatchObject({ title: "Renamed", hasRoute: false });
  });

  it("keeps distance and elevation the host changed in the same save, else takes the route's", async () => {
    const plan = await created({ elevationGainM: "300" });
    await save(plan, { distanceKm: "20" }, fakeGpx(north));
    expect(await stored(plan.planId)).toMatchObject({
      distanceMeters: 20_000,
      elevationGainMeters: 100,
    });
    await save(plan, { elevationGainM: "450" }, fakeGpx(north));
    expect(await stored(plan.planId)).toMatchObject({
      distanceMeters: 1112,
      elevationGainMeters: 450,
    });
    // A field the host cleared is filled from the route.
    await save(plan, { distanceKm: "", elevationGainM: "" }, fakeGpx(old));
    expect(await stored(plan.planId)).toMatchObject({ distanceMeters: 13_495 });
    expect((await stored(plan.planId)).elevationGainMeters).toBeUndefined();
  });

  it("stores meters for imperial forms, when creating and when editing (review fix)", async () => {
    const plan = await created(
      { distanceKm: "", elevationGainM: "", exactLat: "", exactLng: "", exactDescription: "" },
      { units: "imperial", gpx: fakeGpx(north) },
    );
    expect(await stored(plan.planId)).toMatchObject({
      distanceMeters: 1112,
      elevationGainMeters: 100,
    });
    await save(plan, { title: "Renamed" }, fakeGpx(north), { units: "imperial" });
    expect(await stored(plan.planId)).toMatchObject({
      distanceMeters: 1112,
      elevationGainMeters: 100,
    });
  });
});
