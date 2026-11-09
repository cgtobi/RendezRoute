import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createReportRepository } from "../../../../src/adapters/out/sqlite/reports.ts";
import type { Report } from "../../../../src/domain/report.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const reports = () => createReportRepository(database, cipher);
const plans = () => createPlanRepository(database, cipher);
const later = (minutes: number) => new Date(fixtureNow.getTime() + minutes * 60_000);

beforeEach(async () => {
  database = await openDatabase(":memory:");
  await createDeviceRepository(database).create({
    id: "device-1",
    tokenHash: "d1",
    now: fixtureNow,
  });
  for (const [id, title] of [
    ["plan-1", "First plan"],
    ["plan-2", "Second plan"],
  ] as const) {
    await plans().create({
      plan: samplePlan({ id, title }),
      hostTokenHash: `host-${id}`,
      creationNonce: `nonce-${id}`,
      hostDeviceId: "device-1",
    });
  }
});
afterEach(async () => {
  await database.close();
});

const report = (overrides: Partial<Report> = {}): Report => ({
  id: "report-1",
  planId: "plan-1",
  reason: "unsafe",
  details: "SENTINEL-report-details",
  attached: [{ body: "SENTINEL-attached-body", linkUrl: "https://example.org/SENTINEL-link" }],
  createdAt: fixtureNow,
  resolvedAt: undefined,
  ...overrides,
});

describe("SQLite reports (spec 7 Moderation)", () => {
  it("stores details and attachments encrypted, and reads them back", async () => {
    await reports().create(report());
    await reports().create(
      report({ id: "report-2", details: undefined, attached: [], createdAt: later(1) }),
    );
    expect(await reports().listOpenForPlan("plan-1")).toEqual([
      report(),
      report({ id: "report-2", details: undefined, attached: [], createdAt: later(1) }),
    ]);
    const raw = JSON.stringify(database.sqlite.prepare("select * from reports").all());
    expect(raw).not.toContain("SENTINEL");
    expect(raw).not.toContain("example.org");
  });

  it("list open reports oldest first with their plan's title, and resolve them", async () => {
    await reports().create(report({ id: "report-b", createdAt: later(2) }));
    await reports().create(report({ id: "report-a", createdAt: later(1), planId: "plan-2" }));
    expect(await reports().listOpen()).toEqual([
      { planId: "plan-2", planTitle: "Second plan", reason: "unsafe" },
      { planId: "plan-1", planTitle: "First plan", reason: "unsafe" },
    ]);
    expect(await reports().resolve("report-a", later(3))).toEqual({
      planId: "plan-2",
      wasOpen: true,
    });
    expect(await reports().resolve("report-a", later(4))).toEqual({
      planId: "plan-2",
      wasOpen: false,
    });
    expect(await reports().resolve("unknown", later(4))).toBeUndefined();
    expect((await reports().listOpen()).map((r) => r.planId)).toEqual(["plan-1"]);
    expect(await reports().listOpenForPlan("plan-2")).toEqual([]);
    expect(await reports().countResolvedForPlan("plan-2")).toBe(1);
    expect(await reports().countResolvedForPlan("plan-1")).toBe(0);
    const resolvedAt = database.sqlite
      .prepare("select resolved_at from reports where id = 'report-a'")
      .pluck()
      .get();
    expect(resolvedAt).toBe(later(3).toISOString());
  });

  it("go with their plan (spec 3.10)", async () => {
    await reports().create(report());
    await reports().create(report({ id: "report-2", planId: "plan-2" }));
    await plans().delete("plan-1");
    expect(database.sqlite.prepare("select id from reports").pluck().all()).toEqual(["report-2"]);
  });
});
