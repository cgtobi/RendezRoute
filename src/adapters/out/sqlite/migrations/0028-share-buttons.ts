import { type Kysely, sql } from "kysely";

// Share buttons chosen by the host (spec 5 feature 4, decision D41): which of copy link, the
// device's share sheet and WhatsApp the plan page offers, comma-separated; plans and templates
// that existed already keep offering all three.
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of ["plans", "plan_templates"]) {
    await sql`
      alter table ${sql.table(table)}
      add column share_buttons text not null default 'copy,native,whatsApp'
    `.execute(db);
  }
}
