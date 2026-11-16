// The host name a device suggests again on the plan form (D67, I83): read-only, from links that
// already exist; never a participant's name.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { deletePlan } from "../../src/application/host.ts";
import { suggestHostName } from "../../src/application/host-name.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { respond } from "../../src/application/responses.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let clock: FakeClock;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
  clock = new FakeClock(fixtureNow);
  deps = {
    ...createFakeRepositories(),
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
  };
});

async function host(
  posterName: string,
  deviceToken?: string,
  extra: Partial<typeof sampleInput> = {},
) {
  const created = await createPlan(deps, {
    input: { ...sampleInput, posterName, ...extra },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (created.kind !== "created") throw new Error(`plan not created: ${created.kind}`);
  return { planId: created.planId, token: deviceToken ?? created.newDeviceToken };
}

const suggest = (deviceToken: string | undefined, accountName?: string) =>
  suggestHostName(deps, { deviceToken, accountName });

describe("suggestHostName (D67, I83)", () => {
  it("prefers the account's display name over the device's history", async () => {
    const { token } = await host("Anna");
    expect(await suggest(token, "Account Anna")).toBe("Account Anna");
  });

  it("falls back to the device when the account has no display name", async () => {
    const { token } = await host("Anna");
    expect(await suggest(token, undefined)).toBe("Anna");
  });

  it("gives a device the poster name of the plan it hosts", async () => {
    const { token } = await host("Anna");
    expect(await suggest(token)).toBe("Anna");
  });

  it("gives the most recently created of two hosted plans", async () => {
    const first = await host("Old name");
    clock.advance({ minutes: 5 });
    await host("New name", first.token);
    expect(await suggest(first.token)).toBe("New name");
  });

  it("skips whitespace-only names", async () => {
    const first = await host("Anna");
    clock.advance({ minutes: 5 });
    const blank = await host("Ben", first.token);
    const stored = await deps.plans.findById(blank.planId);
    if (stored === undefined) throw new Error("missing plan");
    // Validation never lets a blank name in; the lookup still must not return one.
    await deps.plans.update({ ...stored, posterName: "   " });
    expect(await suggest(first.token)).toBe("Anna");
  });

  it("uses the template when the plan is gone, and never a deleted plan's name otherwise", async () => {
    const kept = await host("Anna", undefined, { keepAsTemplate: "1" });
    await deletePlan(deps, { planId: kept.planId, deviceToken: kept.token });
    expect(await suggest(kept.token)).toBe("Anna");

    const plain = await host("Ben");
    await deletePlan(deps, { planId: plain.planId, deviceToken: plain.token });
    expect(await suggest(plain.token)).toBeUndefined();
  });

  it("prefers a hosted plan over a template", async () => {
    const kept = await host("Old name", undefined, { keepAsTemplate: "1" });
    await deletePlan(deps, { planId: kept.planId, deviceToken: kept.token });
    clock.advance({ days: 1 });
    await host("Current name", kept.token);
    expect(await suggest(kept.token)).toBe("Current name");
  });

  it("gives a device with neither nothing", async () => {
    const { token } = await host("Anna");
    await deps.devices.create({
      id: "bare",
      tokenHash: deps.tokens.hash("bare-token"),
      now: fixtureNow,
    });
    expect(token).toBeDefined();
    expect(await suggest("bare-token")).toBeUndefined();
  });

  it("never uses another device's plans, nor the name of a plan only responded to", async () => {
    const hostDevice = await host("Anna");
    expect(await suggest(undefined)).toBeUndefined();
    const guest = await respond(deps, {
      planId: hostDevice.planId,
      choice: "joined",
      displayName: "Carla",
      requestNote: "",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (guest.kind !== "created") throw new Error(`no response: ${guest.kind}`);
    expect(await suggest(guest.newDeviceToken)).toBeUndefined();
  });

  it("creates and changes nothing for a token that matches no device", async () => {
    const before = deps.devices as unknown as { all(): unknown[] };
    const count = before.all().length;
    expect(await suggest("unknown-token")).toBeUndefined();
    expect(before.all()).toHaveLength(count);
    expect(count).toBe(0);
  });

  it("does not update last use of a known device", async () => {
    const { token } = await host("Anna");
    clock.advance({ days: 3 });
    const hashed = deps.tokens.hash(token ?? "");
    const seenBefore = (await deps.devices.findByTokenHash(hashed))?.lastSeenAt;
    await suggest(token);
    expect((await deps.devices.findByTokenHash(hashed))?.lastSeenAt).toEqual(seenBefore);
  });
});
