import { describe, expect, it } from "vite-plus/test";
import {
  canCancel,
  editScope,
  planToInput,
  removeResponse,
  undoRemoval,
  validatePlanEdit,
  validateRetentionEdit,
} from "../../src/domain/plan-edit.ts";
import type { PlanResponse } from "../../src/domain/response.ts";
import { fixtureNow, samplePlan } from "../fixtures/plans.ts";

const rules = { now: fixtureNow, horizonDays: 180, maxRetentionDays: 30 };
const plan = samplePlan();
const started = new Date("2026-06-07T06:00:00Z");

describe("editScope (spec 3.1 Editing, decision D8)", () => {
  it("allows everything before the start, only retention afterwards or when cancelled", () => {
    expect(editScope(plan, fixtureNow)).toBe("all");
    expect(editScope(plan, started)).toBe("retention");
    expect(editScope({ ...plan, status: "cancelled" }, fixtureNow)).toBe("retention");
  });
});

describe("planToInput", () => {
  it("prefills the edit form so that saving unchanged reproduces the plan", () => {
    const input = planToInput(plan, "metric");
    expect(input).toMatchObject({
      date: "2026-06-07",
      time: "07:30",
      distanceKm: "12.5",
      paceFrom: "5:30",
      paceTo: "6:00",
      exactLat: "48.16321",
    });
    const saved = validatePlanEdit(input, plan, rules, "metric");
    if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
    expect({ ...plan, ...saved.value }).toEqual(plan);
  });

  it("round-trips rides, plans without exact start and plans without optional fields", () => {
    const variants = [
      samplePlan({}, { activity: "ride", paceFrom: "25", paceTo: "28" }),
      samplePlan(
        {},
        {
          exactLat: "",
          exactLng: "",
          exactDescription: "",
          areaLat: "48.15432",
          areaLng: "11.58861",
        },
      ),
      samplePlan(
        {},
        {
          note: "",
          distanceKm: "",
          paceFrom: "",
          paceTo: "",
          exactDescription: "",
          exactLat: "",
          exactLng: "",
        },
      ),
    ];
    for (const variant of variants) {
      const saved = validatePlanEdit(planToInput(variant, "metric"), variant, rules, "metric");
      if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
      expect({ ...variant, ...saved.value }).toEqual(variant);
    }
  });

  it("shows miles and feet with imperial units, and an unchanged form keeps distance and elevation", () => {
    const plan = samplePlan({ distanceMeters: 12500, elevationGainMeters: 350 });
    const input = planToInput(plan, "imperial");
    expect(input.distanceKm).toBe("7.767");
    expect(input.elevationGainM).toBe("1148");
    const saved = validatePlanEdit(input, plan, rules, "imperial");
    if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
    expect(saved.value.distanceMeters).toBe(12500);
    expect(saved.value.elevationGainMeters).toBe(350);
  });
});

describe("validatePlanEdit (spec 3.1 Start date)", () => {
  it("accepts an unchanged start even if it is no longer in the future", () => {
    const input = { ...planToInput(plan, "metric"), title: "Renamed" };
    const afterStart = { ...rules, now: new Date("2026-06-07T05:40:00Z") };
    const saved = validatePlanEdit(input, plan, afterStart, "metric");
    expect(saved.ok && saved.value.title).toBe("Renamed");
  });

  it("requires a changed start to be in the future and within the horizon", () => {
    const input = { ...planToInput(plan, "metric"), date: "2026-05-30" };
    expect(validatePlanEdit(input, plan, rules, "metric")).toEqual({
      ok: false,
      errors: [{ field: "date", code: "starts_in_past" }],
    });
  });

  it("recomputes delete_at when the start or the retention changes (security test)", () => {
    const moved = validatePlanEdit(
      { ...planToInput(plan, "metric"), date: "2026-06-14", retentionDays: "3" },
      plan,
      rules,
      "metric",
    );
    expect(moved.ok && moved.value.deleteAt.toISOString()).toBe("2026-06-17T05:30:00.000Z");
    expect(moved.ok && moved.value.recapWindow).toBe("1d");
  });
});

describe("retention above a lowered maximum (spec 3.10: existing plans keep their promised period)", () => {
  const longPlan = samplePlan({}, { retentionDays: "30" });
  const lowered = { ...rules, maxRetentionDays: 7 };

  it("keeps an unchanged retention valid when editing other fields", () => {
    const saved = validatePlanEdit(
      { ...planToInput(longPlan, "metric"), title: "Renamed" },
      longPlan,
      lowered,
      "metric",
    );
    expect(saved.ok && saved.value.retentionDays).toBe(30);
  });

  it("still applies the maximum to a changed retention", () => {
    const changed = validatePlanEdit(
      { ...planToInput(longPlan, "metric"), retentionDays: "20" },
      longPlan,
      lowered,
      "metric",
    );
    expect(changed).toEqual({
      ok: false,
      errors: [{ field: "retentionDays", code: "retention_out_of_range" }],
    });
  });

  it("keeps an unchanged retention valid in the retention-only edit", () => {
    expect(validateRetentionEdit("30", longPlan, started, 7).ok).toBe(true);
    expect(validateRetentionEdit("20", longPlan, started, 7)).toEqual({
      ok: false,
      error: "retention_out_of_range",
    });
  });
});

describe("validateRetentionEdit (spec 3.1 Retention edits)", () => {
  it("recomputes delete_at and the recap window", () => {
    expect(validateRetentionEdit("3", plan, started, 30)).toEqual({
      ok: true,
      value: {
        retentionDays: 3,
        recapWindow: "1d",
        deleteAt: new Date("2026-06-10T05:30:00Z"),
        deletesNow: false,
      },
    });
  });

  it("flags a deletion date that is already past", () => {
    const result = validateRetentionEdit("1", plan, new Date("2026-06-09T00:00:00Z"), 30);
    expect(result.ok && result.value.deletesNow).toBe(true);
  });

  it("rejects values outside the allowed range", () => {
    expect(validateRetentionEdit("31", plan, started, 30)).toEqual({
      ok: false,
      error: "retention_out_of_range",
    });
    expect(validateRetentionEdit("x", plan, started, 30)).toEqual({
      ok: false,
      error: "retention_out_of_range",
    });
  });
});

describe("canCancel (spec 5 feature 8, decision D8)", () => {
  it("allows cancelling an active plan before its start only", () => {
    expect(canCancel(plan, fixtureNow)).toEqual({ ok: true, value: true });
    expect(canCancel(plan, started)).toEqual({ ok: false, error: "plan_started" });
    expect(canCancel({ ...plan, status: "cancelled" }, fixtureNow)).toEqual({
      ok: false,
      error: "already_cancelled",
    });
  });
});

describe("removal and undo (spec 3.5)", () => {
  const response = (
    kind: PlanResponse["kind"],
    previousKind?: PlanResponse["kind"],
  ): PlanResponse => ({
    id: "r1",
    planId: plan.id,
    kind,
    displayName: "Ben",
    language: "en",
    previousKind,
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  });

  it("removes participants and interested people, remembering their previous kind", () => {
    expect(removeResponse(response("joined"), started)).toEqual({
      ok: true,
      value: { ...response("removed", "joined"), updatedAt: started },
    });
    expect(removeResponse(response("interested"), started).ok).toBe(true);
    expect(removeResponse(response("removed", "joined"), started)).toEqual({
      ok: false,
      error: "not_removable",
    });
  });

  it("undoes a removal by restoring the previous kind", () => {
    expect(undoRemoval(response("removed", "interested"), started)).toEqual({
      ok: true,
      value: { ...response("interested"), updatedAt: started },
    });
    expect(undoRemoval(response("joined"), started)).toEqual({ ok: false, error: "not_removed" });
  });
});
