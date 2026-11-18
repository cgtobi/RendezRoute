// Followers of the instance's actors in SQLite (spec 7 ActivityPub; decision D38): the remote
// actor's address and inboxes encrypted, found by a keyed hash, one row per actor pair.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { createIdGenerator } from "../../../../src/adapters/out/ids.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createFollowerRepository } from "../../../../src/adapters/out/sqlite/followers.ts";
import { fixtureNow } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const hasher = createLookupHasher(randomBytes(32));
const followers = () => createFollowerRepository(database, cipher, hasher, createIdGenerator());

beforeEach(async () => {
  database = await openDatabase(":memory:");
});
afterEach(async () => {
  await database.close();
});

const ben = {
  id: "https://social.example/users/ben",
  inbox: "https://social.example/users/ben/inbox",
  sharedInbox: "https://social.example/inbox",
};
const cleo = {
  id: "https://other.example/@cleo",
  inbox: "https://other.example/@cleo/inbox",
  sharedInbox: undefined,
};

describe("followers in SQLite (decision D38)", () => {
  it("keeps one row per follower and actor, refreshing the inboxes", async () => {
    const repository = followers();
    await repository.add("actor-1", ben, fixtureNow);
    await repository.add("actor-1", { ...ben, sharedInbox: undefined }, fixtureNow);
    // A later time keeps the listed order independent of the random row ids.
    await repository.add("actor-1", cleo, new Date(fixtureNow.getTime() + 1000));
    await repository.add("instance", ben, fixtureNow);
    expect(await repository.count("actor-1")).toBe(2);
    expect(await repository.list("actor-1")).toEqual([{ ...ben, sharedInbox: undefined }, cleo]);
    expect(await repository.count("actor-2")).toBe(0);
  });

  it("stores nothing of the follower's address in the clear", async () => {
    await followers().add("actor-1", ben, fixtureNow);
    const rows = JSON.stringify(database.sqlite.prepare("select * from fediverse_followers").all());
    expect(rows).not.toContain("social.example");
  });

  it("removes one follower, a remote actor everywhere, or every follower", async () => {
    const repository = followers();
    await repository.add("actor-1", ben, fixtureNow);
    await repository.add("actor-1", cleo, fixtureNow);
    await repository.add("actor-2", ben, fixtureNow);
    await repository.add("instance", cleo, fixtureNow);
    await repository.remove("actor-1", ben.id);
    expect(await repository.list("actor-1")).toEqual([cleo]);
    expect(await repository.forget(cleo.id)).toBe(2);
    expect(await repository.count("instance")).toBe(0);
    expect(await repository.clear()).toBe(1);
    expect(await repository.count("actor-2")).toBe(0);
  });
});
