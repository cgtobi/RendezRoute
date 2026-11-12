// Response persistence (spec 3.5, 4). Display names pass through FieldCipher.
import { accessSource } from "./access.ts";
import { type Selectable, sql } from "kysely";
import type {
  FieldCipher,
  LookupHasher,
  RemoteActor,
  RemoteJoin,
  ResponseRepository,
} from "../../../application/ports.ts";
import type { PlanResponse } from "../../../domain/response.ts";
import { checkpoint, type Database } from "./database.ts";
import type { ResponsesTable } from "./schema.ts";

const DISPLAY_NAME = "responses.display_name" as const;
const REQUEST_NOTE = "responses.request_note" as const;
const REMOTE_ACTOR = "responses.remote_actor" as const;

interface StoredRemote {
  id: string;
  inbox: string;
  sharedInbox: string | null;
  join: RemoteJoin;
}

export function createResponseRepository(
  database: Database,
  cipher: FieldCipher,
  hasher: LookupHasher,
): ResponseRepository {
  const fromRow = (row: Selectable<ResponsesTable>): PlanResponse => ({
    id: row.id,
    planId: row.plan_id,
    kind: row.kind,
    displayName: cipher.decrypt(row.display_name_enc, DISPLAY_NAME),
    requestNote:
      row.request_note_enc === null
        ? undefined
        : cipher.decrypt(row.request_note_enc, REQUEST_NOTE),
    language: row.language,
    previousKind: row.previous_kind ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });

  const encryptNote = (note: string | undefined) =>
    note === undefined ? null : cipher.encrypt(note, REQUEST_NOTE);

  // Remote participants (decision D42): the actor's address, inboxes and the activity answered,
  // encrypted, found by a keyed hash of its address, as followers are.
  const remoteHash = (actorId: string) => hasher.hash(`fediverse-actor:${actorId}`);
  const encryptRemote = (actor: RemoteActor, join: RemoteJoin) =>
    cipher.encrypt(
      JSON.stringify({
        id: actor.id,
        inbox: actor.inbox,
        sharedInbox: actor.sharedInbox ?? null,
        join,
      } satisfies StoredRemote),
      REMOTE_ACTOR,
    );
  const decryptRemote = (value: string): { actor: RemoteActor; join: RemoteJoin } => {
    const stored = JSON.parse(cipher.decrypt(value, REMOTE_ACTOR)) as StoredRemote;
    return {
      actor: { id: stored.id, inbox: stored.inbox, sharedInbox: stored.sharedInbox ?? undefined },
      join: stored.join,
    };
  };
  const remoteFromRow = (row: Selectable<ResponsesTable>) =>
    row.remote_actor_enc === null
      ? undefined
      : { response: fromRow(row), ...decryptRemote(row.remote_actor_enc) };

  const selectResponses = () => database.db.selectFrom("responses").selectAll("responses");

  return {
    async createRemote({ response, actor, join, manageTokenHash }) {
      await database.db
        .insertInto("responses")
        .values({
          id: response.id,
          plan_id: response.planId,
          kind: response.kind,
          display_name_enc: cipher.encrypt(response.displayName, DISPLAY_NAME),
          request_note_enc: null,
          manage_token_hash: manageTokenHash,
          device_id: null,
          identity_id: null,
          language: response.language,
          previous_kind: response.previousKind ?? null,
          creation_nonce: null,
          remote_actor_hmac: remoteHash(actor.id),
          remote_actor_enc: encryptRemote(actor, join),
          created_at: response.createdAt.toISOString(),
          updated_at: response.updatedAt.toISOString(),
        })
        .execute();
    },

    async findRemote(planId, actorId) {
      const row = await selectResponses()
        .where("plan_id", "=", planId)
        .where("remote_actor_hmac", "=", remoteHash(actorId))
        .executeTakeFirst();
      return row === undefined ? undefined : remoteFromRow(row);
    },

    async remoteOf(responseId) {
      const row = await selectResponses().where("id", "=", responseId).executeTakeFirst();
      const remote = row === undefined ? undefined : remoteFromRow(row);
      return remote === undefined ? undefined : { actor: remote.actor, join: remote.join };
    },

    async listRemote(planId) {
      const rows = await selectResponses()
        .where("plan_id", "=", planId)
        .where("remote_actor_hmac", "is not", null)
        .orderBy("created_at")
        .orderBy("id")
        .execute();
      return rows.flatMap((row) => remoteFromRow(row) ?? []);
    },

    async listByRemoteActor(actorId) {
      const rows = await selectResponses()
        .where("remote_actor_hmac", "=", remoteHash(actorId))
        .orderBy("created_at")
        .orderBy("id")
        .execute();
      return rows.map(fromRow);
    },

    async updateRemote({ response, actor, join }) {
      await database.db
        .updateTable("responses")
        .set({
          kind: response.kind,
          previous_kind: response.previousKind ?? null,
          request_note_enc: null,
          remote_actor_enc: encryptRemote(actor, join),
          updated_at: response.updatedAt.toISOString(),
        })
        .where("id", "=", response.id)
        .where("remote_actor_hmac", "is not", null)
        .execute();
    },

    async create({ response, manageTokenHash, creationNonce, deviceId, identityId }) {
      await database.db.transaction().execute(async (trx) => {
        await trx
          .insertInto("responses")
          .values({
            id: response.id,
            plan_id: response.planId,
            kind: response.kind,
            display_name_enc: cipher.encrypt(response.displayName, DISPLAY_NAME),
            request_note_enc: encryptNote(response.requestNote),
            manage_token_hash: manageTokenHash,
            device_id: deviceId ?? null,
            identity_id: identityId ?? null,
            language: response.language,
            previous_kind: response.previousKind ?? null,
            creation_nonce: creationNonce,
            created_at: response.createdAt.toISOString(),
            updated_at: response.updatedAt.toISOString(),
          })
          .execute();
        // An account's response reaches its devices through the account (device_access).
        if (deviceId !== undefined && identityId === undefined) {
          await trx
            .insertInto("device_links")
            .values({
              device_id: deviceId,
              role: "manage",
              plan_id: null,
              response_id: response.id,
              created_at: response.createdAt.toISOString(),
            })
            .execute();
        }
      });
    },

    async findById(id) {
      const row = await selectResponses().where("id", "=", id).executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async findByManageTokenHash(hash) {
      const row = await selectResponses().where("manage_token_hash", "=", hash).executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async setManageTokenHash(responseId, hash) {
      await database.db
        .updateTable("responses")
        .set({ manage_token_hash: hash })
        .where("id", "=", responseId)
        .execute();
    },

    async findIdByCreationNonce(nonce) {
      const row = await database.db
        .selectFrom("responses")
        .select("id")
        .where("creation_nonce", "=", nonce)
        .executeTakeFirst();
      return row?.id;
    },

    async findForDevice(planId, deviceId, scope = "device_and_account") {
      const source = accessSource(scope);
      const row = await selectResponses()
        .innerJoin("device_access as access", "access.response_id", "responses.id")
        .where("access.device_id", "=", deviceId)
        .$if(source !== undefined, (query) => query.where("access.source", "=", source ?? "link"))
        .where("access.role", "=", "manage")
        // A browser that responded on its own and then logged in to an account that responded
        // elsewhere: its own response first (spec 3.2), then the oldest.
        .orderBy(sql`case access.source when 'link' then 0 else 1 end`)
        .orderBy("responses.created_at")
        .where("responses.plan_id", "=", planId)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async listByPlan(planId) {
      const rows = await selectResponses()
        .where("plan_id", "=", planId)
        .orderBy("created_at")
        .execute();
      return rows.map(fromRow);
    },

    async counts(planId) {
      const rows = await database.db
        .selectFrom("responses")
        .select(["kind", (eb) => eb.fn.countAll<number>().as("n")])
        .where("plan_id", "=", planId)
        .where("kind", "in", ["interested", "joined"])
        .groupBy("kind")
        .execute();
      const count = (kind: string) => rows.find((row) => row.kind === kind)?.n ?? 0;
      return { interested: count("interested"), participants: count("joined") };
    },

    async update(response) {
      await database.db
        .updateTable("responses")
        .set({
          kind: response.kind,
          display_name_enc: cipher.encrypt(response.displayName, DISPLAY_NAME),
          request_note_enc: encryptNote(response.requestNote),
          previous_kind: response.previousKind ?? null,
          updated_at: response.updatedAt.toISOString(),
        })
        .where("id", "=", response.id)
        .execute();
    },

    async delete(id) {
      await database.db.deleteFrom("responses").where("id", "=", id).execute();
      // Manual deletions also leave the WAL (spec 3.10, decision D8).
      checkpoint(database);
    },

    async isBlocked(planId, deviceId) {
      // The same device, or the account it is logged in to (spec 3.5).
      const row = await database.db
        .selectFrom("responses")
        .select("id")
        .where("plan_id", "=", planId)
        .where("kind", "in", ["rejected", "removed"])
        .where((eb) =>
          eb.or([
            eb("device_id", "=", deviceId),
            eb(
              "identity_id",
              "=",
              eb.selectFrom("devices").select("identity_id").where("id", "=", deviceId),
            ),
          ]),
        )
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
