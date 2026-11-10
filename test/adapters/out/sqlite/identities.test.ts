// Accounts, pending logins and accounts' permissions in SQLite (spec 4 identities, 7 Identity).
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../../src/adapters/out/crypto/keyring.ts";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import {
  createIdentityRepository,
  createPendingLoginRepository,
} from "../../../../src/adapters/out/sqlite/identities.ts";
import {
  createInviteRepository,
  createPermissionRepository,
} from "../../../../src/adapters/out/sqlite/invites.ts";
import type { Identity } from "../../../../src/domain/identity.ts";
import { fixtureNow } from "../../../fixtures/plans.ts";

let database: Database;
const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
const identities = () => createIdentityRepository(database, cipher);
const pending = () => createPendingLoginRepository(database, cipher);
const devices = () => createDeviceRepository(database);
const later = (minutes: number) => new Date(fixtureNow.getTime() + minutes * 60_000);

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  id: "identity-1",
  provider: "oidc",
  subject: "https://id.example.org|SENTINEL-subject",
  handle: undefined,
  displayName: "SENTINEL-name",
  createdAt: fixtureNow,
  lastActiveAt: fixtureNow,
  ...overrides,
});

beforeEach(async () => {
  database = await openDatabase(":memory:");
  await devices().create({ id: "device-1", tokenHash: "hash-1", now: fixtureNow });
  await devices().create({ id: "device-2", tokenHash: "hash-2", now: fixtureNow });
});
afterEach(async () => {
  await database.close();
});

describe("SQLite identities (spec 4, 7 Identity)", () => {
  it("store subject and display name encrypted, found by provider and keyed hash", async () => {
    await identities().create(identity(), "subject-hash");
    expect(await identities().findBySubjectHash("oidc", "subject-hash")).toEqual(identity());
    expect(await identities().findBySubjectHash("fediverse", "subject-hash")).toBeUndefined();
    expect(await identities().findById("identity-1")).toEqual(identity());
    const raw = JSON.stringify(database.sqlite.prepare("select * from identities").all());
    expect(raw).not.toContain("SENTINEL");
    expect(raw).not.toContain("example.org");
  });

  it("change the display name and the last activity", async () => {
    await identities().create(identity(), "subject-hash");
    await identities().setDisplayName("identity-1", "Anna");
    await identities().touch("identity-1", later(5));
    expect(await identities().findById("identity-1")).toEqual(
      identity({ displayName: "Anna", lastActiveAt: later(5) }),
    );
    await identities().setDisplayName("identity-1", undefined);
    expect((await identities().findById("identity-1"))?.displayName).toBeUndefined();
  });

  it("keep a fediverse handle encrypted next to the subject, and change it after a rename", async () => {
    await identities().create(
      identity({ provider: "fediverse", handle: "@anna@SENTINEL.example" }),
      "subject-hash",
    );
    await identities().setHandle("identity-1", "@anna.r@SENTINEL.example");
    expect(await identities().findById("identity-1")).toMatchObject({
      subject: "https://id.example.org|SENTINEL-subject",
      handle: "@anna.r@SENTINEL.example",
    });
    const raw = JSON.stringify(database.sqlite.prepare("select * from identities").all());
    expect(raw).not.toContain("SENTINEL");
  });

  it("are linked to devices, which keep nothing else of them", async () => {
    await identities().create(identity(), "subject-hash");
    await devices().setIdentity("device-1", "identity-1");
    expect(await devices().findByTokenHash("hash-1")).toEqual({
      id: "device-1",
      lastSeenAt: fixtureNow,
      identityId: "identity-1",
    });
    await devices().setIdentity("device-1", undefined);
    expect((await devices().findByTokenHash("hash-1"))?.identityId).toBeUndefined();
  });

  it("keep a device as linked for expiry while it is logged in (spec 3.10)", async () => {
    await identities().create(identity(), "subject-hash");
    await devices().setIdentity("device-1", "identity-1");
    const deleted = await devices().deleteInactive({
      unlinkedLastSeenBefore: later(1),
      anyLastSeenBefore: new Date("2025-06-01T00:00:00Z"),
    });
    expect(deleted).toBe(1);
    expect(await devices().findByTokenHash("hash-1")).toBeDefined();
  });

  it("log their devices out when deleted", async () => {
    await identities().create(identity(), "subject-hash");
    await devices().setIdentity("device-1", "identity-1");
    database.sqlite.prepare("delete from identities").run();
    expect((await devices().findByTokenHash("hash-1"))?.identityId).toBeUndefined();
  });
});

describe("SQLite pending logins (spec 3.11 Account takeover)", () => {
  const login = {
    provider: "oidc" as const,
    secrets: { state: "SENTINEL-state", nonce: "SENTINEL-nonce", codeVerifier: "SENTINEL-pkce" },
    startedAt: fixtureNow,
  };

  it("keep the one-time values encrypted, and can be taken once", async () => {
    await pending().create("state-hash", login);
    const raw = JSON.stringify(database.sqlite.prepare("select * from pending_logins").all());
    expect(raw).not.toContain("SENTINEL");
    expect(await pending().take("state-hash")).toEqual(login);
    expect(await pending().take("state-hash")).toBeUndefined();
    expect(await pending().take("unknown")).toBeUndefined();
  });

  it("keep a fediverse login's server", async () => {
    const fediverse = {
      ...login,
      provider: "fediverse" as const,
      secrets: {
        ...login.secrets,
        server: "https://social.example",
        client: { id: "SENTINEL-client", secret: "SENTINEL-secret" },
      },
    };
    await pending().create("fediverse-state", fediverse);
    expect(await pending().take("fediverse-state")).toEqual(fediverse);
  });

  it("are deleted once started too long ago", async () => {
    await pending().create("old", login);
    await pending().create("new", { ...login, startedAt: later(5) });
    expect(await pending().deleteStartedBefore(later(1))).toBe(1);
    expect(await pending().take("old")).toBeUndefined();
    expect(await pending().take("new")).toBeDefined();
  });
});

describe("SQLite permissions of accounts (spec 7 Moderation)", () => {
  const invites = () => createInviteRepository(database);
  const permissions = () => createPermissionRepository(database);
  const invite = {
    id: "invite-1",
    expiresAt: undefined,
    maxUses: undefined,
    uses: 0,
    revokedAt: undefined,
    createdAt: fixtureNow,
  };

  it("go to the account when the device is logged in, and follow it to its other devices", async () => {
    await identities().create(identity(), "subject-hash");
    await invites().create(invite, "invite-hash");
    await devices().setIdentity("device-1", "identity-1");
    const redeem = (deviceId: string, n: number) =>
      invites().redeem({ inviteId: "invite-1", deviceId, permissionId: `p-${n}`, now: later(n) });
    expect(await redeem("device-1", 1)).toBe("granted");
    const row = database.sqlite.prepare("select device_id, identity_id from permissions").get();
    expect(row).toEqual({ device_id: null, identity_id: "identity-1" });
    expect(await permissions().mayPostSince("device-1")).toEqual(later(1));
    expect(await permissions().mayPostSince("device-2")).toBeUndefined();
    await devices().setIdentity("device-2", "identity-1");
    expect(await permissions().mayPostSince("device-2")).toEqual(later(1));
    expect(await redeem("device-2", 2)).toBe("already_allowed");
    // Logged out, the device no longer may.
    await devices().setIdentity("device-2", undefined);
    expect(await permissions().mayPostSince("device-2")).toBeUndefined();
  });

  it("count the device's own permission and its account's alike", async () => {
    await identities().create(identity(), "subject-hash");
    await invites().create(invite, "invite-hash");
    await invites().redeem({
      inviteId: "invite-1",
      deviceId: "device-1",
      permissionId: "p",
      now: later(1),
    });
    await devices().setIdentity("device-1", "identity-1");
    expect(await permissions().mayPostSince("device-1")).toEqual(later(1));
    expect(
      await invites().redeem({
        inviteId: "invite-1",
        deviceId: "device-1",
        permissionId: "q",
        now: later(2),
      }),
    ).toBe("already_allowed");
  });

  it("go with their account", async () => {
    await identities().create(identity(), "subject-hash");
    await invites().create(invite, "invite-hash");
    await devices().setIdentity("device-1", "identity-1");
    await invites().redeem({
      inviteId: "invite-1",
      deviceId: "device-1",
      permissionId: "p",
      now: later(1),
    });
    database.sqlite.prepare("delete from identities").run();
    expect(database.sqlite.prepare("select count(*) from permissions").pluck().get()).toBe(0);
  });

  it("belong to a device or an account, never both or neither", () => {
    const insert = (deviceId: string | null, identityId: string | null) => () =>
      database.sqlite
        .prepare(
          "insert into permissions (id, device_id, identity_id, permission, created_at) values (?, ?, ?, 'may_post', 'x')",
        )
        .run(`p-${String(deviceId)}-${String(identityId)}`, deviceId, identityId);
    database.sqlite
      .prepare(
        "insert into identities (id, provider, subject_hmac, subject_enc, created_at, last_active_at) values ('i', 'oidc', 'h', 'e', 'x', 'x')",
      )
      .run();
    expect(insert(null, null)).toThrow(/CHECK constraint failed/);
    expect(insert("device-1", "i")).toThrow(/CHECK constraint failed/);
    expect(insert("device-1", null)).not.toThrow();
  });
});
