import { type Kysely, sql } from "kysely";

// Plans, responses and templates in an account (spec 4, 7 Identity; plan v1.0 step 5a): what is
// created while logged in, or claimed, belongs to the account and reaches every device logged in
// to it. Account deletion removes them first (with notices), so the foreign keys only set null.
//
// `device_access` is what a device may act on: its own links (source 'link') and everything its
// account owns (source 'account'). Reads that authorize go through it; writes go to device_links.
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const [table, column] of [
    ["plans", "owner_identity_id"],
    ["plan_templates", "owner_identity_id"],
    ["responses", "identity_id"],
  ] as const) {
    await sql`
      alter table ${sql.table(table)}
      add column ${sql.ref(column)} text references identities (id) on delete set null
    `.execute(db);
    await sql`create index ${sql.ref(`${table}_${column}`)} on ${sql.table(table)} (${sql.ref(column)})`.execute(
      db,
    );
  }
  await sql`
    create view device_access as
      select device_id, role, plan_id, response_id, template_id, 'link' as source from device_links
      union all
      select devices.id, 'host', plans.id, null, null, 'account'
        from devices join plans on plans.owner_identity_id = devices.identity_id
      union all
      select devices.id, 'manage', null, responses.id, null, 'account'
        from devices join responses on responses.identity_id = devices.identity_id
      union all
      select devices.id, 'template', null, null, plan_templates.id, 'account'
        from devices join plan_templates on plan_templates.owner_identity_id = devices.identity_id
  `.execute(db);
}
