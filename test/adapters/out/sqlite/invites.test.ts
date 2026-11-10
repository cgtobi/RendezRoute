// Invite links and posting permissions in SQLite (spec 4 invites and permissions, 7 Moderation).
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../../../src/adapters/out/sqlite/devices.ts";
import {
  createInviteRepository,
  createPermissionRepository,
} from "../../../../src/adapters/out/sqlite/invites.ts";
import type { Invite } from "../../../../src/domain/invite.ts";
import { fixtureNow } from "../../../fixtures/plans.ts";

let database: Database;
const invites = () => createInviteRepository(database);
const permissions = () => createPermissionRepository(database);
const devices = () => createDeviceRepository(database);
const later = (minutes: number) => new Date(fixtureNow.getTime() + minutes * 60_000);

beforeEach(async () => {
  database = await openDatabase(":memory:");
  for (const id of ["device-1", "device-2", "device-3"]) {
    await devices().create({ id, tokenHash: `hash-${id}`, now: fixtureNow });
  }
});
afterEach(async () => {
  await database.close();
});

const invite = (overrides: Partial<Invite> = {}): Invite => ({
  id: "invite-1",
  expiresAt: undefined,
  maxUses: undefined,
  uses: 0,
  revokedAt: undefined,
  createdAt: fixtureNow,
  ...overrides,
});

let n = 0;
const redeem = (deviceId: string, inviteId = "invite-1", now = later(1)) =>
  invites().redeem({ inviteId, deviceId, permissionId: `permission-${++n}`, now });

describe("SQLite invites (spec 7 Moderation)", () => {
  it("stores only the token's hash, and lists invites newest first", async () => {
    await invites().create(invite({ expiresAt: later(60), maxUses: 5 }), "hash-of-first");
    await invites().create(invite({ id: "invite-2", createdAt: later(1) }), "hash-of-second");
    expect(await invites().findByTokenHash("hash-of-first")).toEqual(
      invite({ expiresAt: later(60), maxUses: 5 }),
    );
    expect(await invites().findByTokenHash("unknown")).toBeUndefined();
    expect((await invites().list()).map((i) => i.id)).toEqual(["invite-2", "invite-1"]);
    const columns = database.sqlite
      .prepare("select name from pragma_table_info('invites')")
      .pluck()
      .all();
    expect(columns).toContain("token_hash");
    expect(columns).not.toContain("token");
  });

  it("revokes once, keeping the first time", async () => {
    await invites().create(invite(), "hash");
    expect(await invites().revoke("invite-1", later(1))).toBe(true);
    expect(await invites().revoke("invite-1", later(2))).toBe(true);
    expect(await invites().revoke("unknown", later(2))).toBe(false);
    expect((await invites().findByTokenHash("hash"))?.revokedAt).toEqual(later(1));
  });

  it("lets a device post, counting one use per device", async () => {
    await invites().create(invite(), "hash");
    expect(await permissions().mayPostSince("device-1")).toBeUndefined();
    expect(await redeem("device-1")).toBe("granted");
    expect(await redeem("device-1", "invite-1", later(2))).toBe("already_allowed");
    expect(await permissions().mayPostSince("device-1")).toEqual(later(1));
    expect(await permissions().mayPostSince("device-2")).toBeUndefined();
    expect((await invites().findByTokenHash("hash"))?.uses).toBe(1);
  });

  it("refuses used-up, expired and revoked invites, without counting a use", async () => {
    await invites().create(invite({ maxUses: 1 }), "used-up");
    await invites().create(invite({ id: "invite-2", expiresAt: later(5) }), "expiring");
    await invites().create(invite({ id: "invite-3" }), "revoked");
    expect(await redeem("device-1", "invite-1")).toBe("granted");
    expect(await redeem("device-2", "invite-1")).toBe("unusable");
    expect(await redeem("device-2", "invite-2", later(5))).toBe("unusable");
    await invites().revoke("invite-3", later(1));
    expect(await redeem("device-2", "invite-3")).toBe("unusable");
    expect(await redeem("device-2", "unknown")).toBe("unusable");
    expect(await permissions().mayPostSince("device-2")).toBeUndefined();
    const uses = database.sqlite.prepare("select id, uses from invites order by id").all();
    expect(uses).toEqual([
      { id: "invite-1", uses: 1 },
      { id: "invite-2", uses: 0 },
      { id: "invite-3", uses: 0 },
    ]);
  });

  it("keeps a device's permission when its invite is revoked later", async () => {
    await invites().create(invite(), "hash");
    await redeem("device-1");
    await invites().revoke("invite-1", later(2));
    expect(await permissions().mayPostSince("device-1")).toEqual(later(1));
  });

  it("go with their device (spec 3.7)", async () => {
    await invites().create(invite(), "hash");
    await redeem("device-1");
    await redeem("device-2");
    await devices().delete("device-1");
    const left = database.sqlite.prepare("select device_id from permissions").pluck().all();
    expect(left).toEqual(["device-2"]);
  });

  it("count as a link, so a device allowed to post is kept as long as one with plans (spec 3.10)", async () => {
    await invites().create(invite(), "hash");
    await redeem("device-1");
    await devices().touch("device-3", new Date("2025-05-01T00:00:00Z"));
    await redeem("device-3");
    await devices().touch("device-3", new Date("2025-05-01T00:00:00Z"));
    const deleted = await devices().deleteInactive({
      unlinkedLastSeenBefore: later(1),
      anyLastSeenBefore: new Date("2025-06-01T00:00:00Z"),
    });
    // device-2 had nothing; device-3 had a permission but was unused for over a year.
    expect(deleted).toBe(2);
    expect(await devices().findByTokenHash("hash-device-1")).toBeDefined();
    expect(await devices().findByTokenHash("hash-device-2")).toBeUndefined();
    expect(await devices().findByTokenHash("hash-device-3")).toBeUndefined();
  });
});
