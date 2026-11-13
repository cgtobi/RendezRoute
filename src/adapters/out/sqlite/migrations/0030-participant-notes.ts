import { type Kysely, sql } from "kysely";

// Private direct Notes to accepted remote participants (0.9 step 11b, decision D43): one row per
// Note sent to a remote participant who joined, keyed by that response, so a removed or rejected
// participant loses the row with the response (its Delete is built before the row goes, as in 11a)
// and a deleted plan takes all of its Notes. `note_id` is the random id in the Note's URI;
// `local_actor` is who sent it ("instance" or a poster actor's identifier), the sender of every
// later `Update` and of its `Delete`, whatever the plan is attributed to by then. The
// secret URL token of the GPX document is found by a keyed hash (the identity lookup key, as for
// the actors) and kept encrypted so an `Update` can send the same URL again; both or neither.
// `content_hash` is a keyed hash of what was last sent, so an unchanged edit sends nothing: keyed,
// because the exact start is low-entropy and a plain hash of it could be brute-forced. All in one
// transaction, as Kysely runs SQLite migrations outside one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(migrate);
}

async function migrate(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table participant_notes (
      response_id      text primary key not null references responses (id) on delete cascade,
      plan_id          text not null references plans (id) on delete cascade,
      note_id          text not null unique,
      local_actor      text not null,
      route_token_hmac text unique,
      route_token_enc  text,
      content_hash     text not null,
      sent_at          text not null,
      updated_at       text not null,
      check ((route_token_hmac is null) = (route_token_enc is null))
    ) strict
  `.execute(db);
  // Finds the Notes of a plan, for its deletion and its Updates.
  await sql`create index participant_notes_plan on participant_notes (plan_id)`.execute(db);
  // Finds the Notes an actor sent, for when its profile is turned off or deleted.
  await sql`create index participant_notes_actor on participant_notes (local_actor)`.execute(db);
}
