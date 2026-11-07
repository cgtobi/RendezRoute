// Spec section 4: enum CHECK lists in migrations must match the const arrays in the domain.
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { ACTIVITY_TYPES } from "../../../../src/domain/activity.ts";
import {
  DROP_POLICIES,
  JOIN_MODES,
  PLAN_STATUSES,
  VISIBILITIES,
} from "../../../../src/domain/plan.ts";
import { RECAP_WINDOWS } from "../../../../src/domain/schedule.ts";

let database: Database;
beforeAll(async () => {
  database = await openDatabase(":memory:");
});
afterAll(async () => {
  await database.close();
});

const basePlan: Record<string, string | number> = {
  poster_name: "Anna",
  poster_language: "en",
  activity_type: "run",
  title: "Run",
  starts_at: "2026-06-07T05:30:00.000Z",
  timezone: "Europe/Berlin",
  area_label: "Park",
  drop_policy: "no_drop",
  visibility: "link",
  join_mode: "open",
  status: "active",
  recap_window: "1w",
  retention_days: 14,
  delete_at: "2026-06-21T05:30:00.000Z",
  created_at: "2026-06-01T08:00:00.000Z",
  updated_at: "2026-06-01T08:00:00.000Z",
};

let counter = 0;
function insertPlan(overrides: Record<string, string | number>): boolean {
  counter++;
  const row = { ...basePlan, id: `p${counter}`, host_token_hash: `h${counter}`, ...overrides };
  const columns = Object.keys(row);
  try {
    database.sqlite
      .prepare(
        `insert into plans (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`,
      )
      .run(...Object.values(row));
    return true;
  } catch {
    return false;
  }
}

describe("plans enum columns", () => {
  it.each([
    ["activity_type", ACTIVITY_TYPES],
    ["drop_policy", DROP_POLICIES],
    ["join_mode", JOIN_MODES],
    ["status", PLAN_STATUSES],
    ["recap_window", RECAP_WINDOWS],
  ] as const)("%s accepts exactly the domain values", (column, values) => {
    for (const value of values)
      expect(insertPlan({ [column]: value, retention_days: 14 })).toBe(true);
    expect(insertPlan({ [column]: "bogus" })).toBe(false);
  });

  it("visibility accepts the domain values, except followers until accounts exist (v1.0)", () => {
    for (const value of VISIBILITIES.filter((v) => v !== "followers"))
      expect(insertPlan({ visibility: value })).toBe(true);
    expect(insertPlan({ visibility: "followers" })).toBe(false);
    expect(insertPlan({ visibility: "bogus" })).toBe(false);
  });
});

describe("plans constraints (spec section 4)", () => {
  it("accepts only strict #RRGGBB colors", () => {
    expect(insertPlan({ primary_color: "#2e5bff" })).toBe(true);
    for (const color of ["red", "#FFF", "#2E5BFF;", "#GGGGGG"])
      expect(insertPlan({ primary_color: color })).toBe(false);
  });

  it("requires retention to cover the recap window", () => {
    expect(insertPlan({ retention_days: 6, recap_window: "1w" })).toBe(false);
    expect(insertPlan({ retention_days: 6, recap_window: "1d" })).toBe(true);
    expect(insertPlan({ retention_days: 31, recap_window: "1d" })).toBe(false);
  });

  it("requires coordinate and pace pairs to be complete", () => {
    expect(insertPlan({ area_lat: 48.15 })).toBe(false);
    expect(insertPlan({ pace_min_s_per_km: 300 })).toBe(false);
    expect(insertPlan({ pace_min_s_per_km: 360, pace_max_s_per_km: 300 })).toBe(false);
  });
});

describe("device_links", () => {
  it("accepts only known roles", () => {
    insertPlan({ id: "plan-x", host_token_hash: "hx" });
    database.sqlite.exec(
      "insert into devices values ('d1', 'th1', '2026-06-01T08:00:00.000Z', '2026-06-01T08:00:00.000Z')",
    );
    const link = (role: string) => () =>
      database.sqlite
        .prepare("insert into device_links values ('d1', ?, 'plan-x', '2026-06-01T08:00:00.000Z')")
        .run(role);
    expect(link("bogus")).toThrow(/CHECK constraint failed/);
    expect(link("host")).not.toThrow();
  });
});
