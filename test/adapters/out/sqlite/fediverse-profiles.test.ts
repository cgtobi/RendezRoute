// Poster actors' profiles in SQLite (spec 7 ActivityPub; decisions D36, D37): keys encrypted, one
// active profile per account, and a retired handle never taken again.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { createLookupHasher } from "../../../../src/adapters/out/crypto/lookup-hasher.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createFediverseProfileRepository } from "../../../../src/adapters/out/sqlite/fediverse-profiles.ts";
import { createIdentityRepository } from "../../../../src/adapters/out/sqlite/identities.ts";
import { fixtureNow } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const hasher = createLookupHasher(randomBytes(32));
const profiles = () => createFediverseProfileRepository(database, cipher, hasher);
const KEYS = '[{"SENTINEL":"private-key"}]';

beforeEach(async () => {
  database = await openDatabase(":memory:");
  for (const id of ["identity-1", "identity-2"]) {
    await createIdentityRepository(database, cipher).create(
      {
        id,
        provider: "oidc",
        subject: `https://id.example.org|${id}`,
        handle: undefined,
        displayName: "Anna",
        createdAt: fixtureNow,
        lastActiveAt: fixtureNow,
      },
      `hash-${id}`,
    );
  }
});
afterEach(async () => {
  await database.close();
});

const profile = (overrides = {}) => ({
  id: "actor-1",
  identityId: "identity-1",
  handle: "anna",
  createdAt: fixtureNow,
  keys: KEYS,
  ...overrides,
});

describe("fediverse profiles (decisions D36, D37)", () => {
  it("are found by account, handle and actor, with their keys stored encrypted", async () => {
    expect(await profiles().create(profile())).toBe("created");
    const active = {
      id: "actor-1",
      identityId: "identity-1",
      handle: "anna",
      createdAt: fixtureNow,
    };
    expect(await profiles().findActive("identity-1")).toEqual(active);
    expect(await profiles().findByHandle("anna")).toEqual(active);
    expect(await profiles().findActor("actor-1")).toEqual({
      kind: "active",
      profile: active,
      keys: KEYS,
    });
    const row = JSON.stringify(database.sqlite.prepare("select * from fediverse_profiles").all());
    expect(row).not.toContain("SENTINEL");
  });

  it("give each account one active profile, and each handle one account", async () => {
    await profiles().create(profile());
    expect(await profiles().create(profile({ id: "actor-2", handle: "anna_2" }))).toBe("taken");
    expect(await profiles().create(profile({ id: "actor-3", identityId: "identity-2" }))).toBe(
      "taken",
    );
  });

  it("keep a retired actor as gone and its handle out of reach, without the handle itself", async () => {
    await profiles().create(profile());
    const later = new Date(fixtureNow.getTime() + 60_000);
    expect(await profiles().retire("identity-1", later)).toBe("actor-1");
    expect(await profiles().findActive("identity-1")).toBeUndefined();
    expect(await profiles().findByHandle("anna")).toBeUndefined();
    expect(await profiles().findActor("actor-1")).toEqual({ kind: "retired", retiredAt: later });
    // Nobody takes the handle again, not the same account either.
    expect(await profiles().create(profile({ id: "actor-4", identityId: "identity-2" }))).toBe(
      "taken",
    );
    expect(await profiles().create(profile({ id: "actor-5", handle: "anna_new" }))).toBe("created");
    const rows = JSON.stringify(database.sqlite.prepare("select * from fediverse_profiles").all());
    expect(rows).not.toContain('"anna"');
    expect(await profiles().retire("identity-2", later)).toBeUndefined();
  });

  it("let the account be deleted once retired, and refuse it while active", async () => {
    await profiles().create(profile());
    expect(() =>
      database.sqlite.prepare("delete from identities where id = 'identity-1'").run(),
    ).toThrow(/CHECK constraint failed/);
    await profiles().retire("identity-1", fixtureNow);
    database.sqlite.prepare("delete from identities where id = 'identity-1'").run();
    expect(await profiles().findActor("actor-1")).toMatchObject({ kind: "retired" });
  });
});
