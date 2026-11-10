// Repeatable templates (spec 3.10 Templates, decision I43).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { deletePlan, editPlan } from "../../src/application/host.ts";
import { runHousekeeping, runRetentionSweep } from "../../src/application/maintenance.ts";
import { createPlan, type PlanDeps, viewPlan } from "../../src/application/plans.ts";
import { respond } from "../../src/application/responses.ts";
import { confirmTemplateLink, openTemplateLink } from "../../src/application/secret-links.ts";
import {
  deleteTemplate,
  editTemplate,
  listTemplates,
  removeTemplateRoute,
  repeatTemplate,
  saveAsTemplate,
  viewTemplate,
} from "../../src/application/templates.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import type { PlanInput } from "../../src/domain/plan-input.ts";
import { templateToInput } from "../../src/domain/template.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

// sampleInput starts on 7 June 2026 at 07:30 in Berlin; deleted 14 days later, on 21 June.
const AFTER_DELETION = "2026-06-21T05:30:00Z";
const route = {
  segments: [
    [
      { lat: 48.1631, lng: 11.6014 },
      { lat: 48.17, lng: 11.61 },
    ],
  ],
};

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

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
    postingMode: "anyone",
  };
});

async function newPlan(input: Partial<PlanInput> = {}) {
  const created = await createPlan(deps, {
    input: { ...sampleInput, ...input },
    units: "metric",
    language: "de",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  await repos.plans.saveRoute(created.planId, route);
  await respond(deps, {
    planId: created.planId,
    choice: "joined",
    displayName: "Ben",
    requestNote: "",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  return { planId: created.planId, host: created.newDeviceToken };
}

/** The one template linked to the device. */
async function templateOf(device: string | undefined) {
  const [listed] = await listTemplates(deps, { deviceToken: device });
  if (listed === undefined) return undefined;
  const found = await viewTemplate(deps, { templateId: listed.id, deviceToken: device });
  return found.kind === "found" ? found.template : undefined;
}

describe("templates kept at deletion (spec 3.10)", () => {
  it("only for plans that opted in, by retention or by the host", async () => {
    const plain = await newPlan();
    const kept = await newPlan({ keepAsTemplate: "1", title: "Kept" });
    clock.set(AFTER_DELETION);
    expect(await runRetentionSweep(deps)).toEqual({ deletedPlans: 2 });
    expect(await templateOf(plain.host)).toBeUndefined();
    expect(await templateOf(kept.host)).toMatchObject({ title: "Kept" });

    clock.set(fixtureNow);
    const deleted = await newPlan({ keepAsTemplate: "1", title: "Deleted by host" });
    await deletePlan(deps, { planId: deleted.planId, deviceToken: deleted.host });
    expect(await templateOf(deleted.host)).toMatchObject({ title: "Deleted by host" });
  });

  it("with the exact start and route only when included, and nothing about responses", async () => {
    const plain = await newPlan({ keepAsTemplate: "1" });
    const full = await newPlan({ keepAsTemplate: "1", templateIncludePrivate: "1" });
    clock.set(AFTER_DELETION);
    await runRetentionSweep(deps);
    const withoutPrivate = await templateOf(plain.host);
    expect(withoutPrivate).toMatchObject({ exactStart: undefined, hasRoute: false });
    expect(JSON.stringify(withoutPrivate)).not.toContain("Ben");
    const withPrivate = await templateOf(full.host);
    expect(withPrivate).toMatchObject({
      exactStart: { description: "North gate, by the bike racks" },
      hasRoute: true,
      startTime: "07:30",
      posterLanguage: "de",
    });
    expect(await repos.templates.findRoute(withPrivate?.id ?? "")).toEqual(route);
  });

  it("also when a retention edit deletes the plan right away, with the option from that form", async () => {
    const { planId, host } = await newPlan();
    clock.set("2026-06-09T00:00:00Z");
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing plan");
    const result = await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput(plan, "metric"), retentionDays: "1", keepAsTemplate: "1" },
      units: "metric",
      confirmDeleteNow: true,
    });
    expect(result).toEqual({ kind: "deleted" });
    expect(await templateOf(host)).toMatchObject({ title: "Easy Sunday run" });
  });
});

describe("saving a live plan as template (spec 3.10)", () => {
  it("gives the host a template link that links other devices", async () => {
    const { planId, host } = await newPlan();
    const saved = await saveAsTemplate(deps, {
      planId,
      deviceToken: host,
      includePrivate: false,
      creationNonce: nonce(),
    });
    if (saved.kind !== "saved") throw new Error("not saved");
    expect(await templateOf(host)).toMatchObject({ id: saved.templateId, hasRoute: false });
    expect(await viewPlan(deps, { planId, deviceToken: host })).toMatchObject({ kind: "poster" });

    const opened = await openTemplateLink(deps, { token: saved.hostToken, deviceToken: undefined });
    expect(opened).toEqual({ kind: "confirm", id: saved.templateId, title: "Easy Sunday run" });
    const linked = await confirmTemplateLink(deps, {
      token: saved.hostToken,
      deviceToken: undefined,
    });
    if (linked.kind !== "linked") throw new Error("not linked");
    expect(await templateOf(linked.newDeviceToken)).toMatchObject({ id: saved.templateId });
  });

  it("makes one template per form, however often it is sent", async () => {
    const { planId, host } = await newPlan();
    const request = { planId, deviceToken: host, includePrivate: false, creationNonce: nonce() };
    const saved = await saveAsTemplate(deps, request);
    if (saved.kind !== "saved") throw new Error("not saved");
    expect(await saveAsTemplate(deps, request)).toEqual({
      kind: "duplicate",
      templateId: saved.templateId,
    });
    expect(await listTemplates(deps, { deviceToken: host })).toHaveLength(1);
    expect(await saveAsTemplate(deps, { ...request, creationNonce: "short" })).toEqual({
      kind: "bad_request",
    });
  });

  it("is refused for anyone but the host", async () => {
    const { planId } = await newPlan();
    expect(
      await saveAsTemplate(deps, {
        planId,
        deviceToken: undefined,
        includePrivate: true,
        creationNonce: nonce(),
      }),
    ).toEqual({ kind: "forbidden" });
  });
});

describe("the template page (spec 3.10)", () => {
  async function savedTemplate(includePrivate = true) {
    const { planId, host } = await newPlan();
    const saved = await saveAsTemplate(deps, {
      planId,
      deviceToken: host,
      includePrivate,
      creationNonce: nonce(),
    });
    if (saved.kind !== "saved") throw new Error("not saved");
    return { templateId: saved.templateId, host };
  }

  it("is only for linked devices", async () => {
    const { templateId } = await savedTemplate();
    expect(await viewTemplate(deps, { templateId, deviceToken: undefined })).toEqual({
      kind: "forbidden",
    });
    expect(await viewTemplate(deps, { templateId: "nope", deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
  });

  it("repeats: a new plan on a new date, new links, no responses, route and exact start included", async () => {
    const { templateId, host } = await savedTemplate();
    clock.set("2026-07-01T10:00:00Z");
    const result = await repeatTemplate(deps, {
      templateId,
      deviceToken: host,
      date: "2026-07-05",
      time: "08:00",
      units: "metric",
      creationNonce: nonce(),
    });
    if (result.kind !== "created") throw new Error(`repeat failed: ${result.kind}`);
    expect(result.adjustments).toEqual([]);
    const plan = await repos.plans.findById(result.planId);
    expect(plan).toMatchObject({
      title: "Easy Sunday run",
      startsAt: new Date("2026-07-05T06:00:00Z"),
      exactStart: { description: "North gate, by the bike racks" },
      hasRoute: true,
      posterLanguage: "de",
      template: { keep: false, includePrivate: false },
    });
    expect(await repos.responses.listByPlan(result.planId)).toEqual([]);
    expect(await repos.plans.findRoute(result.planId)).toEqual(route);
    expect((await templateOf(host))?.expiresAt).toEqual(new Date("2026-09-29T10:00:00Z"));
  });

  it("adjusts settings to a lowered retention maximum and says so", async () => {
    const { templateId, host } = await savedTemplate();
    deps = { ...deps, limits: { ...deps.limits, maxRetentionDays: 3 } };
    const result = await repeatTemplate(deps, {
      templateId,
      deviceToken: host,
      date: "2026-07-05",
      time: "08:00",
      units: "metric",
      creationNonce: nonce(),
    });
    if (result.kind !== "created") throw new Error(`repeat failed: ${result.kind}`);
    expect(result.adjustments).toEqual([
      { field: "retentionDays", from: 14, to: 3 },
      { field: "recapWindow", from: "1w", to: "1d" },
    ]);
    expect(await repos.plans.findById(result.planId)).toMatchObject({
      retentionDays: 3,
      recapWindow: "1d",
    });
  });

  it("refuses a past date on the repeat form, and other broken settings until edited", async () => {
    const { templateId, host } = await savedTemplate();
    const repeat = (date: string) =>
      repeatTemplate(deps, {
        templateId,
        deviceToken: host,
        date,
        time: "08:00",
        units: "metric",
        creationNonce: nonce(),
      });
    expect(await repeat("2026-05-01")).toEqual({
      kind: "invalid",
      errors: [{ field: "date", code: "starts_in_past" }],
    });
    const template = await repos.templates.findById(templateId);
    if (template === undefined) throw new Error("missing template");
    await repos.templates.update({ ...template, title: "x".repeat(101) });
    expect(await repeat("2026-07-05")).toEqual({
      kind: "needs_edit",
      errors: [{ field: "title", code: "too_long" }],
    });
  });

  it("is edited, loses its route, and is deleted", async () => {
    const { templateId, host } = await savedTemplate();
    const template = await repos.templates.findById(templateId);
    if (template === undefined) throw new Error("missing template");
    clock.set("2026-08-01T10:00:00Z");
    const input = { ...templateToInput(template, "metric"), title: "Long run", time: "06:45" };
    expect(
      await editTemplate(deps, { templateId, deviceToken: host, input, units: "metric" }),
    ).toEqual({ kind: "updated" });
    expect(await repos.templates.findById(templateId)).toMatchObject({
      title: "Long run",
      startTime: "06:45",
      hasRoute: true,
      expiresAt: new Date("2026-10-30T10:00:00Z"),
    });
    expect(
      await editTemplate(deps, {
        templateId,
        deviceToken: host,
        input: { ...input, title: "" },
        units: "metric",
      }),
    ).toEqual({ kind: "invalid", errors: [{ field: "title", code: "required" }] });

    clock.set("2026-08-15T10:00:00Z");
    await removeTemplateRoute(deps, { templateId, deviceToken: host });
    expect(await repos.templates.findById(templateId)).toMatchObject({
      hasRoute: false,
      expiresAt: new Date("2026-11-13T10:00:00Z"),
    });
    expect(await deleteTemplate(deps, { templateId, deviceToken: host })).toEqual({
      kind: "deleted",
    });
    expect(await listTemplates(deps, { deviceToken: host })).toEqual([]);
  });
});

describe("template expiry (spec 3.10: 90 days without use)", () => {
  it("deletes templates in the daily housekeeping", async () => {
    const { planId, host } = await newPlan();
    await saveAsTemplate(deps, {
      planId,
      deviceToken: host,
      includePrivate: false,
      creationNonce: nonce(),
    });
    const backups = { deleteOlderThan: async () => 0 };
    clock.set("2026-08-30T07:59:00Z");
    expect(await runHousekeeping({ ...deps, backups })).toMatchObject({ deletedTemplates: 0 });
    clock.set("2026-08-30T08:00:00Z");
    expect(await runHousekeeping({ ...deps, backups })).toMatchObject({ deletedTemplates: 1 });
    expect(await listTemplates(deps, { deviceToken: host })).toEqual([]);
  });
});
