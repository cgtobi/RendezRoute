// Reports in SQLite (spec 7 Moderation): details and the attached recap copies pass through
// FieldCipher; the attachments are stored as one encrypted JSON list.
import type { Selectable } from "kysely";
import type { FieldCipher, ReportRepository } from "../../../application/ports.ts";
import { type AttachedContribution, copyOfPost, type Report } from "../../../domain/report.ts";
import type { Database } from "./database.ts";
import type { ReportsTable } from "./schema.ts";
import { iso } from "./shared-fields.ts";

const DETAILS = "reports.details" as const;
const ATTACHED = "reports.attached_content" as const;

/** Only the two known fields of each stored attachment are read back. */
function attachedFrom(json: string): AttachedContribution[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item: { body?: unknown; linkUrl?: unknown }) => ({
    body: typeof item.body === "string" ? item.body : undefined,
    linkUrl: typeof item.linkUrl === "string" ? item.linkUrl : undefined,
  }));
}

export function createReportRepository(database: Database, cipher: FieldCipher): ReportRepository {
  const { db } = database;
  const fromRow = (row: Selectable<ReportsTable>): Report => ({
    id: row.id,
    planId: row.plan_id,
    reason: row.reason,
    details: row.details_enc === null ? undefined : cipher.decrypt(row.details_enc, DETAILS),
    attached:
      row.attached_content_enc === null
        ? []
        : attachedFrom(cipher.decrypt(row.attached_content_enc, ATTACHED)),
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at === null ? undefined : new Date(row.resolved_at),
  });
  return {
    async create(report) {
      await db
        .insertInto("reports")
        .values({
          id: report.id,
          plan_id: report.planId,
          reason: report.reason,
          details_enc:
            report.details === undefined ? null : cipher.encrypt(report.details, DETAILS),
          attached_content_enc:
            report.attached.length === 0
              ? null
              : cipher.encrypt(JSON.stringify(report.attached.map(copyOfPost)), ATTACHED),
          created_at: iso(report.createdAt),
          resolved_at: report.resolvedAt === undefined ? null : iso(report.resolvedAt),
        })
        .execute();
    },

    async listOpen() {
      const rows = await db
        .selectFrom("reports")
        .innerJoin("plans", "plans.id", "reports.plan_id")
        .select(["reports.plan_id", "plans.title", "reports.reason"])
        .where("reports.resolved_at", "is", null)
        .orderBy("reports.created_at")
        .orderBy("reports.id")
        .execute();
      return rows.map((row) => ({ planId: row.plan_id, planTitle: row.title, reason: row.reason }));
    },

    async countOpen() {
      const row = await db
        .selectFrom("reports")
        .innerJoin("plans", "plans.id", "reports.plan_id")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("reports.resolved_at", "is", null)
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    async countCreatedSince(since) {
      const row = await db
        .selectFrom("reports")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("created_at", ">=", iso(since))
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    async listOpenForPlan(planId) {
      const rows = await db
        .selectFrom("reports")
        .selectAll()
        .where("plan_id", "=", planId)
        .where("resolved_at", "is", null)
        .orderBy("created_at")
        .orderBy("id")
        .execute();
      return rows.map(fromRow);
    },

    async countResolvedForPlan(planId) {
      const row = await db
        .selectFrom("reports")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("plan_id", "=", planId)
        .where("resolved_at", "is not", null)
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },

    async resolve(id, at) {
      const row = await db
        .selectFrom("reports")
        .select(["plan_id", "resolved_at"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (row === undefined) return undefined;
      if (row.resolved_at !== null) return { planId: row.plan_id, wasOpen: false };
      await db
        .updateTable("reports")
        .set({ resolved_at: iso(at) })
        .where("id", "=", id)
        .execute();
      return { planId: row.plan_id, wasOpen: true };
    },
  };
}
