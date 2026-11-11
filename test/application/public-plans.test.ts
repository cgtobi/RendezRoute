// Public plans (spec 3.3, 7 Visibility and Nearby plans; decision D35; plan v1.0 step 8a): chosen
// on the create and edit forms; with PUBLIC_REQUIRES_LOGIN only for plans that belong to an
// account; `followers` only with a fediverse profile (step 9b).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { type AccountDeps, finishLogin, startLogin } from "../../src/application/accounts.ts";
import { editPlan, viewHostPage } from "../../src/application/host.ts";
import { createPlan, viewPlan } from "../../src/application/plans.ts";
import { type PlanFor, visibilityChoices } from "../../src/application/public-plans.ts";
import { confirmHostLink } from "../../src/application/secret-links.ts";
import {
  editTemplate,
  repeatTemplate,
  saveAsTemplate,
  viewTemplate,
} from "../../src/application/templates.ts";
import type { ProviderAccount } from "../../src/application/ports.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import type { PlanInput } from "../../src/domain/plan-input.ts";
import { templateToInput } from "../../src/domain/template.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakeIdentityProvider } from "../fakes/identity-provider.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

const anna: ProviderAccount = { subject: "https://id.example.org anna", names: ["Anna"] };

const publicAllowedFor = async (about: PlanFor) =>
  (await visibilityChoices(deps, about)).publicAllowed;

let deps: AccountDeps;
let provider: FakeIdentityProvider;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
  provider = new FakeIdentityProvider();
  deps = {
    ...createFakeRepositories(),
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock: new FakeClock(fixtureNow),
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    publicRequiresLogin: true,
    identityLookup: { hash: (value) => `hmac(${value})` },
    identityProviders: { oidc: provider },
    fediverse: { servers: undefined, allowInsecure: false },
  };
});

/** Logs a device in (a new one by default); returns its token. */
async function logIn(deviceToken?: string): Promise<string> {
  const started = await startLogin(deps, { provider: "oidc" });
  if (started.kind !== "redirect") throw new Error("not started");
  const done = await finishLogin(deps, {
    provider: "oidc",
    callback: provider.approve(started.authorizationUrl, anna),
    cookieState: started.state,
    deviceToken,
  });
  if (done.kind !== "logged_in") throw new Error("login");
  return done.newDeviceToken ?? deviceToken ?? "";
}

async function create(deviceToken: string | undefined, input: Partial<PlanInput> = {}) {
  return createPlan(deps, {
    input: { ...sampleInput, ...input },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
}

async function created(deviceToken: string | undefined, input: Partial<PlanInput> = {}) {
  const result = await create(deviceToken, input);
  if (result.kind !== "created") throw new Error(`create failed: ${JSON.stringify(result)}`);
  return {
    planId: result.planId,
    hostToken: result.hostToken,
    device: deviceToken ?? result.newDeviceToken,
  };
}

/** What the host page's edit form offers this device. */
async function hostPageAllowsPublic(planId: string, deviceToken: string | undefined) {
  const page = await viewHostPage(deps, { planId, deviceToken, units: "metric" });
  return page.kind === "found" && page.visibility.publicAllowed;
}

const visibilityOf = async (planId: string) => (await deps.plans.findById(planId))?.visibility;

async function edit(planId: string, deviceToken: string | undefined, input: Partial<PlanInput>) {
  const plan = await deps.plans.findById(planId);
  if (plan === undefined) throw new Error("no plan");
  return editPlan(deps, {
    planId,
    deviceToken,
    input: { ...planToInput(plan, "metric"), ...input },
    units: "metric",
    confirmDeleteNow: false,
  });
}

describe("choosing who can find a plan (spec 3.3, decision D35)", () => {
  it("is link-only unless chosen otherwise", async () => {
    const { planId } = await created(undefined);
    expect(await visibilityOf(planId)).toBe("link");
  });

  it("makes an account's plan public", async () => {
    const device = await logIn();
    const { planId } = await created(device, { visibility: "public" });
    expect(await visibilityOf(planId)).toBe("public");
    // Public is a public fact: every audience sees it, for the label in the header.
    const seen = await viewPlan(deps, { planId, deviceToken: undefined });
    expect(seen.kind === "viewer" && seen.view.visibility).toBe("public");
  });

  it("refuses public for a plan without an account while login is required", async () => {
    expect(await create(undefined, { visibility: "public" })).toEqual({
      kind: "invalid",
      errors: [{ field: "visibility", code: "public_needs_login" }],
    });
    deps = { ...deps, publicRequiresLogin: false };
    const { planId } = await created(undefined, { visibility: "public" });
    expect(await visibilityOf(planId)).toBe("public");
  });

  it("requires an account when the setting is not given: the stricter rule", async () => {
    const { publicRequiresLogin: _, ...withoutSetting } = deps;
    deps = withoutSetting;
    expect(await publicAllowedFor({ deviceToken: undefined })).toBe(false);
  });

  it("refuses followers without a fediverse profile (decision D37)", async () => {
    const device = await logIn();
    expect(await create(device, { visibility: "followers" })).toEqual({
      kind: "invalid",
      errors: [{ field: "visibility", code: "followers_needs_profile" }],
    });
  });

  it("says on the forms whether public can be chosen", async () => {
    expect(await publicAllowedFor({ deviceToken: undefined })).toBe(false);
    expect(await publicAllowedFor({ deviceToken: await logIn() })).toBe(true);
    deps = { ...deps, publicRequiresLogin: false };
    expect(await publicAllowedFor({ deviceToken: undefined })).toBe(true);
  });
});

describe("editing who can find a plan", () => {
  it("follows the plan's owner, not the editing device", async () => {
    const { planId, hostToken } = await created(await logIn());
    // Another device with the host link, not logged in, edits the account's plan.
    const linked = await confirmHostLink(deps, { token: hostToken, deviceToken: undefined });
    if (linked.kind !== "linked") throw new Error("not linked");
    const device = linked.newDeviceToken;
    expect(await edit(planId, device, { visibility: "public" })).toMatchObject({
      kind: "updated",
    });
    expect(await visibilityOf(planId)).toBe("public");
    expect(await hostPageAllowsPublic(planId, device)).toBe(true);
    expect(await edit(planId, device, { visibility: "link" })).toMatchObject({ kind: "updated" });
    expect(await visibilityOf(planId)).toBe("link");
  });

  it("refuses public for a plan that belongs to no account", async () => {
    const { planId, device } = await created(undefined);
    expect(await hostPageAllowsPublic(planId, device)).toBe(false);
    expect(await edit(planId, device, { visibility: "public" })).toEqual({
      kind: "invalid",
      errors: [{ field: "visibility", code: "public_needs_login" }],
    });
    expect(await visibilityOf(planId)).toBe("link");
  });

  it("keeps a plan public that was made public before login was required", async () => {
    deps = { ...deps, publicRequiresLogin: false };
    const { planId, device } = await created(undefined, { visibility: "public" });
    deps = { ...deps, publicRequiresLogin: true };
    // Like a retention above a lowered maximum (spec 3.10): what was promised stays.
    expect(await hostPageAllowsPublic(planId, device)).toBe(true);
    expect(await edit(planId, device, { title: "Renamed" })).toMatchObject({ kind: "updated" });
    expect(await visibilityOf(planId)).toBe("public");
  });
});

describe("repeating a public template (spec 3.10)", () => {
  async function publicTemplate() {
    deps = { ...deps, publicRequiresLogin: false };
    const { planId, device } = await created(undefined, { visibility: "public" });
    const saved = await saveAsTemplate(deps, {
      planId,
      deviceToken: device,
      includePrivate: false,
      creationNonce: nonce(),
    });
    if (saved.kind !== "saved") throw new Error("not saved");
    deps = { ...deps, publicRequiresLogin: true };
    return { templateId: saved.templateId, device };
  }

  const repeat = (templateId: string, deviceToken: string | undefined) =>
    repeatTemplate(deps, {
      templateId,
      deviceToken,
      date: "2026-06-14",
      time: "07:30",
      units: "metric",
      creationNonce: nonce(),
    });

  async function editTemplateWith(
    templateId: string,
    device: string | undefined,
    input: Partial<PlanInput>,
  ) {
    const found = await viewTemplate(deps, { templateId, deviceToken: device });
    if (found.kind !== "found") throw new Error("no template");
    return {
      publicAllowed: found.visibility.publicAllowed,
      result: await editTemplate(deps, {
        templateId,
        deviceToken: device,
        input: { ...templateToInput(found.template, "metric"), ...input },
        units: "metric",
      }),
    };
  }

  it("keeps a public template public when it is edited, like a plan (decision I58)", async () => {
    const { templateId, device } = await publicTemplate();
    const edited = await editTemplateWith(templateId, device, { title: "Renamed" });
    expect(edited).toEqual({ publicAllowed: true, result: { kind: "updated" } });
    expect((await deps.templates.findById(templateId))?.visibility).toBe("public");
    // Once link-only, public needs an account again.
    await editTemplateWith(templateId, device, { visibility: "link" });
    expect(await editTemplateWith(templateId, device, { visibility: "public" })).toEqual({
      publicAllowed: false,
      result: { kind: "invalid", errors: [{ field: "visibility", code: "public_needs_login" }] },
    });
  });

  it("sets it back to link-only where public is no longer allowed, and says so", async () => {
    const { templateId, device } = await publicTemplate();
    const result = await repeat(templateId, device);
    if (result.kind !== "created") throw new Error(`repeat failed: ${result.kind}`);
    expect(result.adjustments).toEqual([{ field: "visibility", from: "public", to: "link" }]);
    expect(await visibilityOf(result.planId)).toBe("link");
  });

  it("stays public when the plan will belong to an account", async () => {
    const { templateId, device } = await publicTemplate();
    const allowed = await repeat(templateId, await logIn(device));
    if (allowed.kind !== "created") throw new Error(`repeat failed: ${allowed.kind}`);
    expect(allowed.adjustments).toEqual([]);
    expect(await visibilityOf(allowed.planId)).toBe("public");
  });
});
