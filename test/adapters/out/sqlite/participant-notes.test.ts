// Private Notes to remote participants in SQLite (decision D43): one row per response, the route
// token found by a keyed hash and kept encrypted, gone with the response or the plan.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createParticipantNoteRepository } from "../../../../src/adapters/out/sqlite/participant-notes.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import type { ParticipantNote } from "../../../../src/application/ports.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const hasher = createLookupHasher(randomBytes(32));
const notes = () => createParticipantNoteRepository(database, cipher, hasher);

const actor = (name: string) => ({
  id: `https://social.example/users/${name}`,
  inbox: `https://social.example/users/${name}/inbox`,
  sharedInbox: undefined,
});

beforeEach(async () => {
  database = await openDatabase(":memory:");
  await createDeviceRepository(database).create({
    id: "host-device",
    tokenHash: "hash",
    now: fixtureNow,
  });
  for (const id of ["plan-0001", "plan-0002"]) {
    await createPlanRepository(database, cipher).create({
      plan: samplePlan({ id }),
      hostTokenHash: `host-hash-${id}`,
      creationNonce: `nonce-${id}`,
      hostDeviceId: "host-device",
    });
  }
  const responses = createResponseRepository(database, cipher, hasher);
  for (const [id, planId, name] of [
    ["r-1", "plan-0001", "ben"],
    ["r-2", "plan-0001", "cleo"],
    ["r-3", "plan-0002", "dora"],
  ] as const) {
    await responses.createRemote({
      response: {
        id,
        planId,
        kind: "joined",
        displayName: name,
        language: "en",
        previousKind: undefined,
        createdAt: fixtureNow,
        updatedAt: fixtureNow,
      },
      actor: actor(name),
      join: { id: `${actor(name).id}#join`, kind: "join" },
      manageTokenHash: `manage-${id}`,
    });
  }
});
afterEach(async () => {
  await database.close();
});

/** What is passed to create and update: the first-sent time is the database's. */
const note = (
  responseId: string,
  planId: string,
  overrides: Partial<Omit<ParticipantNote, "sentAt">> = {},
) =>
  ({
    responseId,
    planId,
    noteId: `note-${responseId}`,
    localActor: "instance",
    routeToken: `SECRET-TOKEN-${responseId}`,
    contentHash: "route-fp\nrest-fp",
    ...overrides,
  }) satisfies Omit<ParticipantNote, "sentAt">;

describe("participant notes", () => {
  it("keep the route token encrypted and found only by its keyed hash", async () => {
    const repo = notes();
    await repo.create(note("r-1", "plan-0001"), fixtureNow);
    await repo.create(note("r-2", "plan-0001", { routeToken: undefined }), fixtureNow);
    const stored = JSON.stringify(database.sqlite.prepare("select * from participant_notes").all());
    expect(stored).not.toContain("SECRET-TOKEN");
    const [first] = database.sqlite
      .prepare(
        "select route_token_hmac, route_token_enc from participant_notes order by response_id",
      )
      .all() as { route_token_hmac: string | null; route_token_enc: string | null }[];
    expect(first?.route_token_hmac).toBe(hasher.hash("participant-note-route:SECRET-TOKEN-r-1"));
    expect(first?.route_token_enc).not.toBeNull();

    expect(await repo.find("r-1")).toEqual({ ...note("r-1", "plan-0001"), sentAt: fixtureNow });
    expect(await repo.find("r-2")).toEqual({
      ...note("r-2", "plan-0001", { routeToken: undefined }),
      sentAt: fixtureNow,
    });
    expect((await repo.findByRouteToken("SECRET-TOKEN-r-1"))?.responseId).toBe("r-1");
    expect(await repo.findByRouteToken("SECRET-TOKEN-r-2")).toBeUndefined();
    expect(await repo.findByRouteToken("")).toBeUndefined();
  });

  it("replace the token on update, so the old link stops working", async () => {
    const repo = notes();
    await repo.create(note("r-1", "plan-0001"), fixtureNow);
    await repo.update(
      note("r-1", "plan-0001", { routeToken: "NEW-TOKEN", contentHash: "a\nb" }),
      fixtureNow,
    );
    expect(await repo.findByRouteToken("SECRET-TOKEN-r-1")).toBeUndefined();
    expect((await repo.find("r-1"))?.routeToken).toBe("NEW-TOKEN");
    await repo.update(note("r-1", "plan-0001", { routeToken: undefined }), fixtureNow);
    expect(await repo.findByRouteToken("NEW-TOKEN")).toBeUndefined();
    expect((await repo.find("r-1"))?.routeToken).toBeUndefined();
  });

  it("are listed by plan, deleted one by one, and go with the response and the plan", async () => {
    const repo = notes();
    await repo.create(note("r-1", "plan-0001"), fixtureNow);
    await repo.create(note("r-2", "plan-0001"), fixtureNow);
    await repo.create(note("r-3", "plan-0002"), fixtureNow);
    expect((await repo.listByPlan("plan-0001")).map((n) => n.responseId).sort()).toEqual([
      "r-1",
      "r-2",
    ]);
    await repo.delete("r-1");
    expect(await repo.find("r-1")).toBeUndefined();
    await createResponseRepository(database, cipher, hasher).delete("r-2");
    expect(await repo.find("r-2")).toBeUndefined();
    await createPlanRepository(database, cipher).delete("plan-0002");
    expect(await repo.find("r-3")).toBeUndefined();
    expect(await repo.findByRouteToken("SECRET-TOKEN-r-3")).toBeUndefined();
  });

  it("have one Note per response, with a unique identifier and a unique link", async () => {
    const repo = notes();
    expect(await repo.create(note("r-1", "plan-0001"), fixtureNow)).toBe(true);
    // A second attempt at the same moment stores nothing and says so, rather than failing.
    expect(await repo.create(note("r-1", "plan-0001", { noteId: "other" }), fixtureNow)).toBe(
      false,
    );
    expect((await repo.find("r-1"))?.noteId).toBe("note-r-1");
    await expect(
      repo.create(note("r-2", "plan-0001", { noteId: "note-r-1" }), fixtureNow),
    ).rejects.toThrow(/UNIQUE/);
    await expect(
      repo.create(note("r-2", "plan-0001", { routeToken: "SECRET-TOKEN-r-1" }), fixtureNow),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("remember who sent them, and are found by that actor", async () => {
    const repo = notes();
    await repo.create(note("r-1", "plan-0001", { localActor: "anna-id" }), fixtureNow);
    await repo.create(note("r-2", "plan-0001"), fixtureNow);
    await repo.create(note("r-3", "plan-0002", { localActor: "anna-id" }), fixtureNow);
    expect((await repo.find("r-1"))?.localActor).toBe("anna-id");
    expect((await repo.listByActor("anna-id")).map((n) => n.responseId)).toEqual(["r-1", "r-3"]);
    expect((await repo.listByActor("instance")).map((n) => n.responseId)).toEqual(["r-2"]);
    expect(await repo.listByActor("nobody")).toEqual([]);
    // An update keeps the sender and the first-sent time.
    const later = new Date(fixtureNow.getTime() + 60_000);
    await repo.update(
      note("r-1", "plan-0001", { localActor: "anna-id", contentHash: "x\ny" }),
      later,
    );
    expect(await repo.find("r-1")).toMatchObject({
      localActor: "anna-id",
      sentAt: fixtureNow,
      contentHash: "x\ny",
    });
  });

  it("store a changed sender on update, as when the actor can no longer sign", async () => {
    const repo = notes();
    await repo.create(note("r-1", "plan-0001", { localActor: "anna-id" }), fixtureNow);
    await repo.update(note("r-1", "plan-0001", { localActor: "instance" }), fixtureNow);
    expect((await repo.find("r-1"))?.localActor).toBe("instance");
    expect((await repo.listByActor("anna-id")).map((n) => n.responseId)).toEqual([]);
    expect((await repo.listByActor("instance")).map((n) => n.responseId)).toEqual(["r-1"]);
  });

  it("fingerprint with the key, not plainly", () => {
    const repo = notes();
    expect(repo.fingerprint("rest:[48.1,11.5]")).toBe(
      hasher.hash("participant-note:rest:[48.1,11.5]"),
    );
    expect(repo.fingerprint("a")).not.toBe(repo.fingerprint("b"));
  });
});
