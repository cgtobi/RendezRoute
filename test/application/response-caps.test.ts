// The hard cap on web responses per plan, and the shared cap on notices to the host (0.19.0).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { respond, updateMyResponse, withdrawMyResponse } from "../../src/application/responses.ts";
import { MAX_WEB_RESPONSES_PER_PLAN } from "../../src/domain/responding.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let planId: string;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(async () => {
  repos = createFakeRepositories();
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock: new FakeClock(fixtureNow),
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
  };
  const created = await createPlan(deps, {
    input: sampleInput,
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  planId = created.planId;
});

const join = (name: string, extra: { takeHostNotice?: () => boolean } = {}) =>
  respond(deps, {
    planId,
    choice: "joined",
    displayName: name,
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
    ...extra,
  });

describe("at most 300 web responses a plan", () => {
  it("refuses new joins at the cap, while those in can still edit and withdraw", async () => {
    const first = await join("Person 0");
    if (first.kind !== "created") throw new Error("not created");
    for (let i = 1; i < MAX_WEB_RESPONSES_PER_PLAN; i++) {
      expect((await join(`Person ${i}`)).kind).toBe("created");
    }
    expect(MAX_WEB_RESPONSES_PER_PLAN).toBe(300);
    expect(await join("One too many")).toEqual({ kind: "full" });
    expect(await repos.responses.countWebResponses(planId)).toBe(300);

    const edited = await updateMyResponse(deps, {
      planId,
      deviceToken: first.newDeviceToken,
      choice: "interested",
      displayName: "Renamed",
    });
    expect(edited.kind).toBe("updated");
    expect(await withdrawMyResponse(deps, { planId, deviceToken: first.newDeviceToken })).toEqual({
      kind: "withdrawn",
    });
    expect((await join("Fits again")).kind).toBe("created");
  });
});

describe("the notice to the host of a web join", () => {
  it("asks once per new response, and the join is kept when the notice is dropped", async () => {
    const asked: string[] = [];
    const result = await join("Ben", {
      takeHostNotice: () => {
        asked.push("asked");
        return false;
      },
    });
    expect(result.kind).toBe("created");
    expect(asked).toEqual(["asked"]);
    expect(await repos.responses.counts(planId)).toEqual({ interested: 0, participants: 1 });
  });

  it("also asks for a switch to joining on the manage page, and keeps the change", async () => {
    const interested = await respond(deps, {
      planId,
      choice: "interested",
      displayName: "Ben",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (interested.kind !== "created") throw new Error("not created");
    let asked = 0;
    const updated = await updateMyResponse(deps, {
      planId,
      deviceToken: interested.newDeviceToken,
      choice: "joined",
      displayName: "Ben",
      takeHostNotice: () => {
        asked++;
        return false;
      },
    });
    expect(updated).toEqual({ kind: "updated", notifiedHost: true });
    expect(asked).toBe(1);
    expect(await repos.responses.counts(planId)).toEqual({ interested: 0, participants: 1 });
  });
});
