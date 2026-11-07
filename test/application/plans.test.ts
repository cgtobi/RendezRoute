import { beforeEach, describe, expect, it } from "vite-plus/test";
import { confirmHostLink, openHostLink } from "../../src/application/secret-links.ts";
import { createPlan, type PlanDeps, viewPlan } from "../../src/application/plans.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;

beforeEach(() => {
  repos = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
  };
});

const NONCE = "nonce-aaaaaaaaaaaaaaaa";

async function created(deviceToken?: string) {
  const result = await createPlan(deps, {
    input: sampleInput,
    units: "metric",
    language: "de",
    creationNonce: NONCE,
    deviceToken,
  });
  if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
  return result;
}

describe("createPlan (spec 5 feature 1)", () => {
  it("creates the plan, issues a host link and a new device for a browser without one", async () => {
    const result = await created();
    expect(result).toEqual({
      kind: "created",
      planId: "plan-0001",
      hostToken: "token-0001",
      newDeviceToken: "token-0002",
      deleteAt: new Date("2026-06-21T05:30:00Z"),
      timeZone: "Europe/Berlin",
    });
    const plan = await repos.plans.findById("plan-0001");
    expect(plan).toMatchObject({
      title: "Easy Sunday run",
      posterLanguage: "de",
      visibility: "link",
      joinMode: "open",
      status: "active",
    });
    expect(await repos.plans.findByHostTokenHash(deps.tokens.hash("token-0001"))).toBeDefined();
  });

  it("links the creating device as host (spec 3.2)", async () => {
    const result = await created();
    const device = await repos.devices.findByTokenHash(
      deps.tokens.hash(result.newDeviceToken ?? ""),
    );
    expect(
      await repos.devices.hasLink(device?.id ?? "", { role: "host", planId: result.planId }),
    ).toBe(true);
  });

  it("reuses an existing device", async () => {
    const first = await created();
    const second = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: "nonce-bbbbbbbbbbbbbbbb",
      deviceToken: first.newDeviceToken,
    });
    expect(second).toMatchObject({ kind: "created", newDeviceToken: undefined });
    expect(repos.devices.all()).toHaveLength(1);
  });

  it("returns field errors without storing anything", async () => {
    const result = await createPlan(deps, {
      input: { ...sampleInput, title: "" },
      units: "metric",
      language: "en",
      creationNonce: NONCE,
      deviceToken: undefined,
    });
    expect(result).toEqual({ kind: "invalid", errors: [{ field: "title", code: "required" }] });
    expect(repos.devices.all()).toHaveLength(0);
  });

  it("detects a resubmitted form instead of creating a second plan (decision I9)", async () => {
    const first = await created();
    const again = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: NONCE,
      deviceToken: first.newDeviceToken,
    });
    expect(again).toEqual({ kind: "duplicate", planId: first.planId });
    expect(await repos.plans.findById("plan-0002")).toBeUndefined();
  });

  it("answers a concurrent double submit with one plan and one duplicate", async () => {
    const submit = () =>
      createPlan(deps, {
        input: sampleInput,
        units: "metric",
        language: "en",
        creationNonce: NONCE,
        deviceToken: undefined,
      });
    const results = await Promise.all([submit(), submit()]);
    expect(results.map((result) => result.kind).sort()).toEqual(["created", "duplicate"]);
  });

  it("rejects a missing or malformed form nonce", async () => {
    for (const creationNonce of ["", "short", "has spaces in it!!!!"]) {
      const result = await createPlan(deps, {
        input: sampleInput,
        units: "metric",
        language: "en",
        creationNonce,
        deviceToken: undefined,
      });
      expect(result).toEqual({ kind: "bad_request" });
    }
  });
});

describe("viewPlan (spec 3.6, 2a privacy boundary)", () => {
  it("gives plain viewers the viewer read model, which has no exact start", async () => {
    await created();
    const result = await viewPlan(deps, { planId: "plan-0001", deviceToken: undefined });
    expect(result.kind).toBe("viewer");
    if (result.kind !== "viewer") return;
    expect(result.view).not.toHaveProperty("exactStart");
    expect(JSON.stringify(result.view)).not.toContain("North gate");
    expect(JSON.stringify(result.view)).not.toContain("48.16321");
    expect(result.view).toMatchObject({
      title: "Easy Sunday run",
      area: { label: "Englischer Garten, north end", point: { lat: 48.16, lng: 11.6 } },
    });
  });

  it("gives the host device the poster read model with the exact start", async () => {
    const { newDeviceToken } = await created();
    const result = await viewPlan(deps, { planId: "plan-0001", deviceToken: newDeviceToken });
    expect(result).toMatchObject({
      kind: "poster",
      view: {
        exactStart: {
          description: "North gate, by the bike racks",
          point: { lat: 48.16321, lng: 11.60147 },
        },
      },
    });
  });

  it("treats unknown device tokens as viewers", async () => {
    await created();
    expect((await viewPlan(deps, { planId: "plan-0001", deviceToken: "forged" })).kind).toBe(
      "viewer",
    );
  });

  it("reports unknown plans", async () => {
    expect(await viewPlan(deps, { planId: "nope", deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
  });

  it("updates device activity at most once per day (spec 3.2)", async () => {
    const { newDeviceToken } = await created();
    const seen = async () =>
      (
        await repos.devices.findByTokenHash(deps.tokens.hash(newDeviceToken ?? ""))
      )?.lastSeenAt.toISOString();
    clock.advance({ hours: 23 });
    await viewPlan(deps, { planId: "plan-0001", deviceToken: newDeviceToken });
    expect(await seen()).toBe(fixtureNow.toISOString());
    clock.advance({ hours: 2 });
    await viewPlan(deps, { planId: "plan-0001", deviceToken: newDeviceToken });
    expect(await seen()).toBe(clock.now().toISOString());
  });
});

describe("host link (spec 3.2, decision D1)", () => {
  it("asks for confirmation on a device that is not linked yet, without changing anything", async () => {
    const { hostToken } = await created();
    const before = repos.devices.all().length;
    expect(await openHostLink(deps, { token: hostToken, deviceToken: undefined })).toEqual({
      kind: "confirm",
      planId: "plan-0001",
      title: "Easy Sunday run",
    });
    expect(repos.devices.all()).toHaveLength(before);
  });

  it("changes no state when opened, not even device activity (decision D1)", async () => {
    const { hostToken, newDeviceToken } = await created();
    clock.advance({ days: 3 });
    await openHostLink(deps, { token: hostToken, deviceToken: newDeviceToken });
    const device = await repos.devices.findByTokenHash(deps.tokens.hash(newDeviceToken ?? ""));
    expect(device?.lastSeenAt).toEqual(fixtureNow);
  });

  it("skips confirmation for a device that is already linked", async () => {
    const { hostToken, newDeviceToken } = await created();
    expect(await openHostLink(deps, { token: hostToken, deviceToken: newDeviceToken })).toEqual({
      kind: "already_linked",
      planId: "plan-0001",
    });
  });

  it("links a new device on confirmation and makes it a host", async () => {
    const { hostToken } = await created();
    const confirmed = await confirmHostLink(deps, { token: hostToken, deviceToken: undefined });
    expect(confirmed).toMatchObject({ kind: "linked", planId: "plan-0001" });
    if (confirmed.kind !== "linked") return;
    const view = await viewPlan(deps, {
      planId: "plan-0001",
      deviceToken: confirmed.newDeviceToken,
    });
    expect(view.kind).toBe("poster");
  });

  it("links an existing device without issuing a new one", async () => {
    const { hostToken } = await created();
    const other = await confirmHostLink(deps, { token: hostToken, deviceToken: undefined });
    if (other.kind !== "linked") throw new Error("expected linked");
    expect(
      await confirmHostLink(deps, { token: hostToken, deviceToken: other.newDeviceToken }),
    ).toEqual({
      kind: "linked",
      planId: "plan-0001",
      newDeviceToken: undefined,
    });
  });

  it("rejects unknown tokens", async () => {
    await created();
    expect(await openHostLink(deps, { token: "wrong", deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
    expect(await confirmHostLink(deps, { token: "wrong", deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
  });
});
