import { type Kysely, sql } from "kysely";

// Recap over federation (0.9 step 12a, decisions D44 and D45). Both tables cascade with their
// contribution, response and plan, and each `Delete` is built before its row goes, as in 11a and
// 11b. `contribution_notes` has one row per direct Note sent with a contribution to a joined remote
// participant, so the Note is sent once and its `Update` and `Delete` find it. `note_id` is the
// random id in the Note's URI; it shares that namespace with `participant_notes.note_id`, so
// uniqueness across the two tables relies on the ids being UUIDs. `local_actor` is who sent the
// Note at its `Create`: the sender of every later `Update` and of its `Delete`. `content_hash` is a
// keyed hash of the author's name, text and link, so an unchanged edit sends nothing: keyed,
// because the content is private and low-entropy. `remote_contributions` maps a remote participant's own reply
// Note to the contribution made from it, by a keyed hash of the Note's id (the id itself is not
// stored), so the author's later `Update` or `Delete` finds the contribution. All in one
// transaction, as Kysely runs SQLite migrations outside one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(migrate);
}

async function migrate(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table contribution_notes (
      note_id          text primary key not null,
      contribution_id  text not null references recap_contributions (id) on delete cascade,
      response_id      text not null references responses (id) on delete cascade,
      plan_id          text not null references plans (id) on delete cascade,
      local_actor      text not null,
      content_hash     text not null,
      sent_at          text not null,
      updated_at       text not null,
      unique (contribution_id, response_id)
    ) strict
  `.execute(db);
  // Finds the Notes of a remote recipient, for its deletion (the unique key finds a contribution's).
  await sql`create index contribution_notes_response on contribution_notes (response_id)`.execute(
    db,
  );
  // Finds the Notes of a plan, for its deletion.
  await sql`create index contribution_notes_plan on contribution_notes (plan_id)`.execute(db);
  // Finds the Notes an actor sent, for when its profile is turned off or deleted.
  await sql`create index contribution_notes_actor on contribution_notes (local_actor)`.execute(db);
  await sql`
    create table remote_contributions (
      contribution_id  text primary key not null
        references recap_contributions (id) on delete cascade,
      response_id      text not null references responses (id) on delete cascade,
      plan_id          text not null references plans (id) on delete cascade,
      remote_note_hmac text not null,
      created_at       text not null,
      unique (response_id, remote_note_hmac)
    ) strict
  `.execute(db);
  // Finds the mappings of a plan, for its deletion. The unique key finds an author's mappings.
  await sql`create index remote_contributions_plan on remote_contributions (plan_id)`.execute(db);
}
