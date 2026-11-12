import { describe, expect, it } from "vite-plus/test";
import { validatePlanInput } from "../../src/domain/plan-input.ts";
import {
  repeatInput,
  templateExpiresAt,
  templateFromPlan,
  templateToInput,
  validateTemplateEdit,
} from "../../src/domain/template.ts";
import { fixtureNow, sampleInput, samplePlan } from "../fixtures/plans.ts";

const rules = { now: fixtureNow, horizonDays: 180, maxRetentionDays: 30 };
const now = new Date("2026-06-25T10:00:00Z");
const template = (includePrivate = false) =>
  templateFromPlan(samplePlan({ hasRoute: true }), { id: "t-1", includePrivate, now });

describe("templateFromPlan (spec 3.10 Templates)", () => {
  it("copies the base data and the local start time, with the exact start and route only on opt-in", () => {
    const plain = template();
    expect(plain).toMatchObject({
      id: "t-1",
      posterName: "Anna",
      posterLanguage: "en",
      title: "Easy Sunday run",
      note: "Bring water.",
      timeZone: "Europe/Berlin",
      startTime: "07:30",
      area: { label: "Englischer Garten, north end", point: samplePlan().area.point },
      distanceMeters: 12500,
      joinMode: "open",
      visibility: "link",
      retentionDays: 14,
      recapWindow: "1w",
      exactStart: undefined,
      hasRoute: false,
      lastUsedAt: now,
      expiresAt: new Date("2026-09-23T10:00:00Z"),
    });
    expect(template(true)).toMatchObject({
      exactStart: samplePlan().exactStart,
      hasRoute: true,
    });
  });

  it("keeps nothing about responses or the plan's dates", () => {
    expect(Object.keys(template(true)).sort()).toEqual(
      [
        "activity",
        "area",
        "colors",
        "createdAt",
        "distanceMeters",
        "dropPolicy",
        "elevationGainMeters",
        "exactStart",
        "expiresAt",
        "hasRoute",
        "id",
        "joinMode",
        "lastUsedAt",
        "note",
        "pace",
        "posterLanguage",
        "posterName",
        "recapWindow",
        "retentionDays",
        // The host's choice of share buttons (decision D41).
        "shareButtons",
        "startTime",
        "timeZone",
        "title",
        "updatedAt",
        "visibility",
      ].sort(),
    );
  });
});

describe("templateExpiresAt", () => {
  it("is 90 days after the last use", () => {
    expect(templateExpiresAt(now)).toEqual(new Date("2026-09-23T10:00:00Z"));
  });
});

describe("repeatInput (spec 3.10: re-validated, adjusted, the host is told)", () => {
  it("gives the plan form values for the new date, which validate to the same details", () => {
    const { input, adjustments } = repeatInput(
      template(true),
      { date: "2026-07-05", time: "08:00" },
      "metric",
      { maxRetentionDays: 30, publicAllowed: true, followersAllowed: true },
    );
    expect(adjustments).toEqual([]);
    expect(input).toMatchObject({ date: "2026-07-05", time: "08:00", keepAsTemplate: "" });
    const draft = validatePlanInput(input, rules, "metric");
    expect(draft.ok && draft.value).toMatchObject({
      title: "Easy Sunday run",
      exactStart: samplePlan().exactStart,
      area: samplePlan().area,
      pace: samplePlan().pace,
      startsAt: new Date("2026-07-05T06:00:00Z"),
      template: { keep: false, includePrivate: false },
    });
  });

  it("lowers a retention above the current maximum and shortens the recap window to fit", () => {
    const { input, adjustments } = repeatInput(
      template(),
      { date: "2026-07-05", time: "08:00" },
      "metric",
      { maxRetentionDays: 3, publicAllowed: true, followersAllowed: true },
    );
    expect(adjustments).toEqual([
      { field: "retentionDays", from: 14, to: 3 },
      { field: "recapWindow", from: "1w", to: "1d" },
    ]);
    expect(input).toMatchObject({ retentionDays: "3", recapWindow: "1d" });
  });

  it("sets a public template back to link-only where the new plan may not be public (D35)", () => {
    const publicOne = { ...template(), visibility: "public" as const };
    const when = { date: "2026-07-05", time: "08:00" };
    const kept = repeatInput(publicOne, when, "metric", {
      maxRetentionDays: 30,
      publicAllowed: true,
      followersAllowed: true,
    });
    expect(kept.adjustments).toEqual([]);
    expect(kept.input.visibility).toBe("public");
    const back = repeatInput(publicOne, when, "metric", {
      maxRetentionDays: 30,
      publicAllowed: false,
      followersAllowed: true,
    });
    expect(back.adjustments).toEqual([{ field: "visibility", from: "public", to: "link" }]);
    expect(back.input.visibility).toBe("link");
  });
});

describe("validateTemplateEdit", () => {
  it("checks the plan form without a date, and keeps the start time", () => {
    const input = { ...templateToInput(template(), "metric"), title: "Long run", time: "06:45" };
    const result = validateTemplateEdit(input, template(), rules, "metric");
    expect(result.ok && result.value).toMatchObject({ title: "Long run", startTime: "06:45" });
    expect(result.ok && "startsAt" in result.value).toBe(false);
  });

  it("reports a bad time on the time field, and keeps a retention above a lowered maximum", () => {
    const input = templateToInput(template(), "metric");
    expect(validateTemplateEdit({ ...input, time: "25:00" }, template(), rules, "metric")).toEqual({
      ok: false,
      errors: [expect.objectContaining({ field: "time" })],
    });
    const lowered = { ...rules, maxRetentionDays: 7 };
    expect(validateTemplateEdit(input, template(), lowered, "metric").ok).toBe(true);
    expect(
      validateTemplateEdit({ ...input, retentionDays: "10" }, template(), lowered, "metric").ok,
    ).toBe(false);
  });

  it("keeps a time that a clock change skips on the stand-in date", () => {
    // Berlin skips 02:00–03:00 on 29 March 2026; the stand-in date is that day.
    const input = { ...templateToInput(template(), "metric"), time: "02:30" };
    const beforeChange = { ...rules, now: new Date("2026-03-28T10:00:00Z") };
    const result = validateTemplateEdit(input, template(), beforeChange, "metric");
    expect(result.ok && result.value.startTime).toBe("02:30");
  });

  it("ignores template options sent with it", () => {
    const input = { ...sampleInput, date: "", keepAsTemplate: "1" };
    expect(validateTemplateEdit(input, template(), rules, "metric").ok).toBe(true);
  });
});
