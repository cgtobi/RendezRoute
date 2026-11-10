// Accounts and pending logins (spec 4 identities, 7 Identity, 3.11). The subject and display name
// are encrypted and an account is found by a keyed hash of its subject; a pending login's one-time
// values are encrypted too, and taken once.
import type {
  FieldCipher,
  IdentityRepository,
  LoginSecrets,
  PendingLoginRepository,
} from "../../../application/ports.ts";
import type { Identity } from "../../../domain/identity.ts";
import { checkpoint, type Database } from "./database.ts";
import type { IdentitiesTable } from "./schema.ts";

const COLUMNS = [
  "id",
  "provider",
  "subject_enc",
  "display_name_enc",
  "created_at",
  "last_active_at",
] as const;

export function createIdentityRepository(
  database: Database,
  cipher: FieldCipher,
): IdentityRepository {
  const { db } = database;
  const identityOf = (row: Pick<IdentitiesTable, (typeof COLUMNS)[number]>): Identity => ({
    id: row.id,
    provider: row.provider,
    subject: cipher.decrypt(row.subject_enc, "identities.subject"),
    displayName:
      row.display_name_enc === null
        ? undefined
        : cipher.decrypt(row.display_name_enc, "identities.display_name"),
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
  });
  const nameEnc = (name: string | undefined) =>
    name === undefined ? null : cipher.encrypt(name, "identities.display_name");

  return {
    async create(identity, subjectHash) {
      await db
        .insertInto("identities")
        .values({
          id: identity.id,
          provider: identity.provider,
          subject_hmac: subjectHash,
          subject_enc: cipher.encrypt(identity.subject, "identities.subject"),
          display_name_enc: nameEnc(identity.displayName),
          created_at: identity.createdAt.toISOString(),
          last_active_at: identity.lastActiveAt.toISOString(),
        })
        .execute();
    },

    async findBySubjectHash(provider, subjectHash) {
      const row = await db
        .selectFrom("identities")
        .select(COLUMNS)
        .where("provider", "=", provider)
        .where("subject_hmac", "=", subjectHash)
        .executeTakeFirst();
      return row === undefined ? undefined : identityOf(row);
    },

    async findById(id) {
      const row = await db
        .selectFrom("identities")
        .select(COLUMNS)
        .where("id", "=", id)
        .executeTakeFirst();
      return row === undefined ? undefined : identityOf(row);
    },

    async setDisplayName(id, displayName) {
      await db
        .updateTable("identities")
        .set({ display_name_enc: nameEnc(displayName) })
        .where("id", "=", id)
        .execute();
      checkpoint(database);
    },

    async touch(id, now) {
      await db
        .updateTable("identities")
        .set({ last_active_at: now.toISOString() })
        .where("id", "=", id)
        .execute();
    },
  };
}

export function createPendingLoginRepository(
  database: Database,
  cipher: FieldCipher,
): PendingLoginRepository {
  const { db } = database;
  return {
    async create(stateHash, login) {
      await db
        .insertInto("pending_logins")
        .values({
          state_hash: stateHash,
          provider: login.provider,
          secrets_enc: cipher.encrypt(JSON.stringify(login.secrets), "pending_logins.secrets"),
          started_at: login.startedAt.toISOString(),
        })
        .execute();
    },

    async take(stateHash) {
      const row = await db
        .deleteFrom("pending_logins")
        .where("state_hash", "=", stateHash)
        .returning(["provider", "secrets_enc", "started_at"])
        .executeTakeFirst();
      if (row === undefined) return undefined;
      const stored = JSON.parse(cipher.decrypt(row.secrets_enc, "pending_logins.secrets")) as
        | LoginSecrets
        | undefined;
      // Field by field: nothing else stored ever comes back.
      const secrets: LoginSecrets = {
        state: String(stored?.state),
        nonce: String(stored?.nonce),
        codeVerifier: String(stored?.codeVerifier),
      };
      return { provider: row.provider, secrets, startedAt: new Date(row.started_at) };
    },

    async deleteStartedBefore(cutoff) {
      const result = await db
        .deleteFrom("pending_logins")
        .where("started_at", "<", cutoff.toISOString())
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}
