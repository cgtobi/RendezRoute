// Poster actors' profiles (spec 7 ActivityPub; decisions D36, D37). The signing keys are stored
// encrypted with the field cipher; every handle, active or retired, is also kept as a keyed hash,
// which is all that remains of it once retired, so it is never taken again.
import type {
  FediverseProfile,
  FediverseProfileRepository,
  FieldCipher,
  LookupHasher,
} from "../../../application/ports.ts";
import type { Database } from "./database.ts";
import type { FediverseProfilesTable } from "./schema.ts";

const KEYS_CONTEXT = "fediverse_profiles.keys";

export function createFediverseProfileRepository(
  database: Database,
  cipher: FieldCipher,
  hasher: LookupHasher,
): FediverseProfileRepository {
  const { db } = database;
  const handleHash = (handle: string) => hasher.hash(`fediverse-handle:${handle}`);
  const toActiveProfile = (row: FediverseProfilesTable): FediverseProfile | undefined =>
    row.retired_at !== null || row.identity_id === null || row.handle === null
      ? undefined
      : {
          id: row.id,
          identityId: row.identity_id,
          handle: row.handle,
          createdAt: new Date(row.created_at),
        };
  const select = () => db.selectFrom("fediverse_profiles").selectAll();
  const clashing = (
    query: Pick<Database["db"], "selectFrom">,
    profile: { identityId: string; handle: string },
  ) =>
    query
      .selectFrom("fediverse_profiles")
      .select("id")
      .where((eb) =>
        eb.or([
          eb("handle_hmac", "=", handleHash(profile.handle)),
          eb.and([eb("identity_id", "=", profile.identityId), eb("retired_at", "is", null)]),
        ]),
      )
      .executeTakeFirst();

  return {
    async findActive(identityId) {
      const row = await select()
        .where("identity_id", "=", identityId)
        .where("retired_at", "is", null)
        .executeTakeFirst();
      return row === undefined ? undefined : toActiveProfile(row);
    },

    async findByHandle(handle) {
      const row = await select()
        .where("handle", "=", handle)
        .where("retired_at", "is", null)
        .executeTakeFirst();
      return row === undefined ? undefined : toActiveProfile(row);
    },

    async findActor(id) {
      const row = await select().where("id", "=", id).executeTakeFirst();
      if (row === undefined) return undefined;
      if (row.retired_at !== null) return { kind: "retired", retiredAt: new Date(row.retired_at) };
      const profile = toActiveProfile(row);
      if (profile === undefined || row.keys_enc === null) return undefined;
      return { kind: "active", profile, keys: cipher.decrypt(row.keys_enc, KEYS_CONTEXT) };
    },

    async isTaken(profile) {
      return (await clashing(db, profile)) !== undefined;
    },

    async create(profile) {
      return db.transaction().execute(async (trx) => {
        if ((await clashing(trx, profile)) !== undefined) return "taken" as const;
        await trx
          .insertInto("fediverse_profiles")
          .values({
            id: profile.id,
            identity_id: profile.identityId,
            handle: profile.handle,
            handle_hmac: handleHash(profile.handle),
            keys_enc: cipher.encrypt(profile.keys, KEYS_CONTEXT),
            created_at: profile.createdAt.toISOString(),
            retired_at: null,
          })
          .execute();
        return "created" as const;
      });
    },

    async retire(identityId, now) {
      const row = await select()
        .where("identity_id", "=", identityId)
        .where("retired_at", "is", null)
        .executeTakeFirst();
      if (row === undefined) return undefined;
      // Only the identifier and the handle's hash stay (decision D37).
      await db
        .updateTable("fediverse_profiles")
        .set({ identity_id: null, handle: null, keys_enc: null, retired_at: now.toISOString() })
        .where("id", "=", row.id)
        .execute();
      return row.id;
    },
  };
}
