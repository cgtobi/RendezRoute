// Remote participants in SQLite (spec 7 ActivityPub, 3.7; decision D42): the actor's address,
// inboxes and the activity answered encrypted, found by a keyed hash, one response per actor and
// plan, no device.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../../../src/adapters/out/sqlite/responses.ts";
import type { RemoteActor, RemoteJoin } from "../../../../src/application/ports.ts";
import type { PlanResponse } from "../../../../src/domain/response.ts";
import { fixtureNow, samplePlan } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const hasher = createLookupHasher(randomBytes(32));
const responses = () => createResponseRepository(database, cipher, hasher);

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
});
afterEach(async () => {
  await database.close();
});

const ben: RemoteActor = {
  id: "https://social.example/users/ben",
  inbox: "https://social.example/users/ben/inbox",
  sharedInbox: "https://social.example/inbox",
};
const cleo: RemoteActor = {
  id: "https://other.example/users/cleo",
  inbox: "https://other.example/users/cleo/inbox",
  sharedInbox: undefined,
};
const join: RemoteJoin = { id: "https://social.example/users/ben#join-1", kind: "join" };

const response = (id: string, planId: string, overrides: Partial<PlanResponse> = {}) =>
  ({
    id,
    planId,
    kind: "joined",
    displayName: "SENTINEL-ben@social.example",
    language: "en",
    previousKind: undefined,
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
    ...overrides,
  }) satisfies PlanResponse;

describe("remote participants", () => {
  it("are stored encrypted, without a device, and read back decoded", async () => {
    const repo = responses();
    await repo.createRemote({
      response: response("r-1", "plan-0001"),
      actor: ben,
      join,
      manageTokenHash: "token-hash-1",
    });
    await repo.createRemote({
      response: response("r-2", "plan-0001", { kind: "interested" }),
      actor: cleo,
      join: { id: "https://other.example/users/cleo#t", kind: "tentative" },
      manageTokenHash: "token-hash-2",
    });
    const stored = JSON.stringify(database.sqlite.prepare("select * from responses").all());
    for (const plaintext of ["social.example", "other.example", "SENTINEL", "join-1"]) {
      expect(stored).not.toContain(plaintext);
    }
    expect(
      database.sqlite.prepare("select device_id, identity_id, creation_nonce from responses").all(),
    ).toEqual([
      { device_id: null, identity_id: null, creation_nonce: null },
      { device_id: null, identity_id: null, creation_nonce: null },
    ]);

    expect(await repo.findRemote("plan-0001", ben.id)).toEqual({
      response: response("r-1", "plan-0001"),
      actor: ben,
      join,
    });
    expect((await repo.findRemote("plan-0001", cleo.id))?.actor).toEqual(cleo);
    expect(await repo.findRemote("plan-0002", ben.id)).toBeUndefined();
    expect(await repo.remoteOf("r-2")).toEqual({
      actor: cleo,
      join: { id: "https://other.example/users/cleo#t", kind: "tentative" },
    });
    expect((await repo.listRemote("plan-0001")).map((entry) => entry.actor.id)).toEqual([
      ben.id,
      cleo.id,
    ]);
    expect(await repo.listRemote("plan-0002")).toEqual([]);
    // The ids alone, without opening the actors: the same people in the same order.
    expect(await repo.listRemoteIds("plan-0001")).toEqual(["r-1", "r-2"]);
    expect(await repo.listRemoteIds("plan-0002")).toEqual([]);
    // Listed with everyone else, counted like anyone.
    expect((await repo.listByPlan("plan-0001")).map((r) => r.id)).toEqual(["r-1", "r-2"]);
    expect(await repo.counts("plan-0001")).toEqual({ interested: 1, participants: 1 });
  });

  it("have one response per actor and plan, and a web response is no remote one", async () => {
    const repo = responses();
    await repo.createRemote({
      response: response("r-1", "plan-0001"),
      actor: ben,
      join,
      manageTokenHash: "token-hash-1",
    });
    await expect(
      repo.createRemote({
        response: response("r-2", "plan-0001"),
        actor: ben,
        join,
        manageTokenHash: "token-hash-2",
      }),
    ).rejects.toThrow(/UNIQUE/);
    await repo.createRemote({
      response: response("r-3", "plan-0002"),
      actor: ben,
      join,
      manageTokenHash: "token-hash-3",
    });
    await repo.create({
      response: response("r-web", "plan-0001"),
      manageTokenHash: "manage-web",
      creationNonce: "nonce-web",
      deviceId: "host-device",
    });
    expect(await repo.remoteOf("r-web")).toBeUndefined();
    expect(await repo.listRemote("plan-0001")).toHaveLength(1);
  });

  it("change kind and the activity answered, and nothing else", async () => {
    const repo = responses();
    await repo.createRemote({
      response: response("r-1", "plan-0001", { kind: "requested" }),
      actor: ben,
      join,
      manageTokenHash: "token-hash-1",
    });
    const tentative: RemoteJoin = { id: "https://social.example/users/ben#t-2", kind: "tentative" };
    const found = await repo.findRemote("plan-0001", ben.id);
    if (found === undefined) throw new Error("missing");
    const later = new Date(fixtureNow.getTime() + 60_000);
    await repo.updateRemote({
      ...found,
      join: tentative,
      response: { ...found.response, kind: "interested", updatedAt: later },
    });
    expect(await repo.findRemote("plan-0001", ben.id)).toEqual({
      response: { ...found.response, kind: "interested", updatedAt: later },
      actor: ben,
      join: tentative,
    });
  });

  it("are found across plans by the actor and deleted one by one, with the plan", async () => {
    const repo = responses();
    for (const [id, planId, actor] of [
      ["r-1", "plan-0001", ben],
      ["r-2", "plan-0002", ben],
      ["r-3", "plan-0002", cleo],
    ] as const) {
      await repo.createRemote({
        response: response(id, planId),
        actor,
        join,
        manageTokenHash: `token-hash-${id}`,
      });
    }
    expect((await repo.listByRemoteActor(ben.id)).map((r) => r.id)).toEqual(["r-1", "r-2"]);
    expect(await repo.listByRemoteActor("https://social.example/users/nobody")).toEqual([]);
    await repo.delete("r-1");
    expect((await repo.listByRemoteActor(ben.id)).map((r) => r.id)).toEqual(["r-2"]);
    await createPlanRepository(database, cipher).delete("plan-0002");
    expect(await repo.listByRemoteActor(ben.id)).toEqual([]);
    expect(await repo.listRemote("plan-0002")).toEqual([]);
  });

  it("need the address and its hash together, and no device", async () => {
    const repo = responses();
    await repo.createRemote({
      response: response("r-1", "plan-0001"),
      actor: ben,
      join,
      manageTokenHash: "token-hash-1",
    });
    expect(() =>
      database.sqlite.prepare("update responses set remote_actor_enc = null").run(),
    ).toThrow(/CHECK/);
    expect(() =>
      database.sqlite.prepare("update responses set device_id = 'host-device'").run(),
    ).toThrow(/CHECK/);
  });
});
