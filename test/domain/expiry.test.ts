import { describe, expect, it } from "vite-plus/test";
import { capRetention, deviceExpiryCutoffs } from "../../src/domain/expiry.ts";
import { fixtureNow, samplePlan } from "../fixtures/plans.ts";

describe("deviceExpiryCutoffs (spec 3.10 Other expiry, decision D9)", () => {
  it("is 30 days for devices without links and 365 days for any device", () => {
    expect(deviceExpiryCutoffs(new Date("2026-06-01T08:00:00Z"))).toEqual({
      unlinkedLastSeenBefore: new Date("2026-05-02T08:00:00Z"),
      anyLastSeenBefore: new Date("2025-06-01T08:00:00Z"),
    });
  });
});

describe("capRetention (spec 3.10 apply-retention-max)", () => {
  const plan = samplePlan(); // starts 2026-06-07T05:30Z, retention 14

  it("leaves plans within the maximum untouched", () => {
    expect(capRetention(plan, 14, fixtureNow)).toEqual({ kind: "unchanged" });
  });

  it("shortens retention, recomputing delete_at and the recap window", () => {
    expect(capRetention(plan, 3, fixtureNow)).toEqual({
      kind: "shortened",
      retentionDays: 3,
      recapWindow: "1d",
      deleteAt: new Date("2026-06-10T05:30:00Z"),
    });
  });

  it("deletes plans whose new deletion date has passed", () => {
    expect(capRetention(plan, 3, new Date("2026-06-10T05:30:00Z"))).toEqual({ kind: "delete" });
  });
});
