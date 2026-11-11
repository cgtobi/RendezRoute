// Followers of the instance's actors (spec 7 ActivityPub; decision D38): the remote actor's
// address and inboxes stored encrypted with the field cipher, found by a keyed hash of its address.
import type {
  FieldCipher,
  FollowerRepository,
  IdGenerator,
  LookupHasher,
  RemoteActor,
} from "../../../application/ports.ts";
import type { Database } from "./database.ts";

const REMOTE_CONTEXT = "fediverse_followers.remote";

export function createFollowerRepository(
  database: Database,
  cipher: FieldCipher,
  hasher: LookupHasher,
  ids: IdGenerator,
): FollowerRepository {
  const { db } = database;
  const remoteHash = (remoteActorId: string) => hasher.hash(`fediverse-actor:${remoteActorId}`);
  const encrypt = (actor: RemoteActor) =>
    cipher.encrypt(
      JSON.stringify({ id: actor.id, inbox: actor.inbox, sharedInbox: actor.sharedInbox ?? null }),
      REMOTE_CONTEXT,
    );
  const decrypt = (value: string): RemoteActor => {
    const stored = JSON.parse(cipher.decrypt(value, REMOTE_CONTEXT)) as {
      id: string;
      inbox: string;
      sharedInbox: string | null;
    };
    return { id: stored.id, inbox: stored.inbox, sharedInbox: stored.sharedInbox ?? undefined };
  };

  return {
    async add(localActor, follower, now) {
      await db
        .insertInto("fediverse_followers")
        .values({
          id: ids.rowId(),
          local_actor: localActor,
          remote_hmac: remoteHash(follower.id),
          remote_enc: encrypt(follower),
          created_at: now.toISOString(),
        })
        .onConflict((conflict) =>
          conflict
            .columns(["local_actor", "remote_hmac"])
            .doUpdateSet({ remote_enc: encrypt(follower) }),
        )
        .execute();
    },

    async remove(localActor, remoteActorId) {
      await db
        .deleteFrom("fediverse_followers")
        .where("local_actor", "=", localActor)
        .where("remote_hmac", "=", remoteHash(remoteActorId))
        .execute();
    },

    async forget(remoteActorId) {
      const result = await db
        .deleteFrom("fediverse_followers")
        .where("remote_hmac", "=", remoteHash(remoteActorId))
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    async count(localActor) {
      const row = await db
        .selectFrom("fediverse_followers")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("local_actor", "=", localActor)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    async list(localActor) {
      const rows = await db
        .selectFrom("fediverse_followers")
        .select("remote_enc")
        .where("local_actor", "=", localActor)
        .orderBy("created_at")
        .orderBy("id")
        .execute();
      return rows.map((row) => decrypt(row.remote_enc));
    },

    async clear() {
      const result = await db.deleteFrom("fediverse_followers").executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}
