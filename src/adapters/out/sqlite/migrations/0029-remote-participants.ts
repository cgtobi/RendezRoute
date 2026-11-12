import { type Kysely, sql } from "kysely";

// Remote participants (0.9 step 11a, decision D42): a remote actor's Join or TentativeAccept is a
// row in `responses`, like a web response, but has no device. Such rows carry a random manage token
// hash (never shown, so nobody can manage them) and no creation nonce. The actor's address and
// inboxes are stored encrypted (field responses.remote_actor), found by a keyed hash of the actor
// identifier. The columns are added in place, so no table is rebuilt; the unique index is partial
// because SQLite cannot add a UNIQUE column. All in one transaction, as Kysely runs SQLite
// migrations outside one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(migrate);
}

async function migrate(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table responses
      add column remote_actor_hmac text
      check (remote_actor_hmac is null or device_id is null)
  `.execute(db);
  await sql`
    alter table responses
      add column remote_actor_enc text
      check ((remote_actor_hmac is null) = (remote_actor_enc is null))
  `.execute(db);
  // One response per remote actor and plan (a repeated Join is an update, not a second row).
  await sql`
    create unique index responses_plan_remote_actor on responses (plan_id, remote_actor_hmac)
      where remote_actor_hmac is not null
  `.execute(db);
  // Finds every response of an actor, for its Delete (across plans).
  await sql`
    create index responses_remote_actor on responses (remote_actor_hmac)
      where remote_actor_hmac is not null
  `.execute(db);
}
