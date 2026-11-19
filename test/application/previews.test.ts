import { beforeEach, describe, expect, it } from "vite-plus/test";
import { cancelPlan, editPlan } from "../../src/application/host.ts";
import { PALETTES } from "../../src/domain/palette.ts";
import { previewOf } from "../../src/application/plan-views.ts";
import { createPlan, type PlanDeps, viewPlan } from "../../src/application/plans.ts";
import { previewImage } from "../../src/application/previews.ts";
import { respond } from "../../src/application/responses.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakePreviewRenderer } from "../fakes/preview-renderer.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { fakeGpx, FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, samplePlan, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let renderer: FakePreviewRenderer;

beforeEach(() => {
  repos = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  renderer = new FakePreviewRenderer();
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
  };
});

const SENTINEL = "SENTINEL-exact-start";

async function created() {
  const result = await createPlan(deps, {
    input: { ...sampleInput, exactDescription: SENTINEL },
    units: "metric",
    language: "de",
    creationNonce: "nonce-aaaaaaaaaaaaaaaa",
    deviceToken: undefined,
    gpx: fakeGpx({
      segments: [
        [
          { lat: 47.98765, lng: 10.1 },
          { lat: 47.99, lng: 10.1 },
        ],
      ],
    }),
  });
  if (result.kind !== "created") throw new Error(result.kind);
  return result;
}

describe("previewOf (spec 3.3, 2b: link previews never show the exact start or route)", () => {
  it("contains only public fields, in the plan's language", () => {
    const preview = previewOf(samplePlan({ posterLanguage: "de" }, { exactDescription: SENTINEL }));
    const text = JSON.stringify(preview);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain("48.16321");
    expect(text).not.toContain("Anna");
    expect(preview).toMatchObject({
      id: "plan-0001",
      title: "Easy Sunday run",
      activity: "run",
      areaLabel: "Englischer Garten, north end",
      areaPoint: { lat: 48.16, lng: 11.6 },
      distanceMeters: 12_500,
      language: "de",
      status: "active",
    });
  });

  it("changes its version whenever the plan changes", () => {
    const before = previewOf(samplePlan()).version;
    expect(previewOf(samplePlan()).version).toBe(before);
    expect(previewOf(samplePlan({ updatedAt: new Date("2026-06-02T00:00:00Z") })).version).not.toBe(
      before,
    );
  });

  it("changes its version with the instance palette and only with it", () => {
    const plan = samplePlan();
    const versions = PALETTES.map((palette) => previewOf(plan, palette).version);
    expect(new Set(versions).size).toBe(PALETTES.length);
    expect(previewOf(plan, "bold").version).toBe(previewOf(plan, "bold").version);
    expect(previewOf(plan).version).toBe(previewOf(plan, "default").version);
    expect(versions.every((v) => /^l4[0-9][a-z0-9]+$/.test(v))).toBe(true);
  });
});

describe("viewPlan previews", () => {
  it("gives every audience the same public preview", async () => {
    const plan = await created();
    const host = await viewPlan(deps, { planId: plan.planId, deviceToken: plan.newDeviceToken });
    await respond(deps, {
      planId: plan.planId,
      deviceToken: undefined,
      displayName: "Ben",
      choice: "joined",
      language: "en",
      creationNonce: "nonce-bbbbbbbbbbbbbbbb",
    });
    const viewer = await viewPlan(deps, { planId: plan.planId, deviceToken: undefined });
    if (host.kind === "not_found" || viewer.kind === "not_found") throw new Error("not found");
    expect(host.kind).toBe("poster");
    expect(host.preview).toEqual(viewer.preview);
    expect(JSON.stringify(host.preview)).not.toContain(SENTINEL);
    expect(JSON.stringify(host.preview)).not.toContain("47.98765");
  });
});

describe("previewImage (spec 3.10: cached, deleted with the plan)", () => {
  const image = (planId: string) => previewImage({ ...deps, renderer }, { planId });

  it("answers unknown plans with not found", async () => {
    expect(await image("missing")).toEqual({ kind: "not_found" });
  });

  it("renders once and serves the cached image until the plan changes", async () => {
    const plan = await created();
    const first = await image(plan.planId);
    expect(first.kind).toBe("found");
    expect(await image(plan.planId)).toEqual(first);
    expect(renderer.rendered).toHaveLength(1);

    clock.set("2026-06-02T08:00:00Z");
    await editPlan(deps, {
      planId: plan.planId,
      deviceToken: plan.newDeviceToken,
      input: { ...sampleInput, title: "Renamed" },
      units: "metric",
      confirmDeleteNow: false,
    });
    const second = await image(plan.planId);
    expect(second).not.toEqual(first);
    expect(renderer.rendered.map((p) => p.title)).toEqual(["Easy Sunday run", "Renamed"]);
  });

  it("shows cancelled plans as cancelled", async () => {
    const plan = await created();
    clock.set("2026-06-02T08:00:00Z");
    await cancelPlan(deps, { planId: plan.planId, deviceToken: plan.newDeviceToken });
    await image(plan.planId);
    expect(renderer.rendered[0]?.status).toBe("cancelled");
  });

  it("reports a busy renderer without caching anything", async () => {
    const plan = await created();
    renderer.busy = true;
    expect(await image(plan.planId)).toEqual({ kind: "busy" });
    renderer.busy = false;
    expect((await image(plan.planId)).kind).toBe("found");
  });

  it("asks before rendering, but not for cached images (rate limits, decision I32)", async () => {
    const plan = await created();
    const asked: string[] = [];
    const limited = () =>
      previewImage(
        { ...deps, renderer },
        { planId: plan.planId, mayRender: () => !asked.push("x") },
      );
    expect(await limited()).toEqual({ kind: "limited" });
    expect(renderer.rendered).toHaveLength(0);
    await image(plan.planId);
    expect((await limited()).kind).toBe("found");
    expect(asked).toHaveLength(1);
  });
});
