import { describe, expect, it } from "vite-plus/test";
import { createIngressAdminAuth } from "../../../../src/adapters/out/admin/ingress-admin-auth.ts";

describe("Home Assistant Ingress identity (decision D56)", () => {
  const auth = createIngressAdminAuth({ peer: "172.30.32.2" });
  const allowed = { kind: "allowed" };
  const notAdmin = { kind: "denied", reason: "not_admin" };
  const notSupervisor = { kind: "denied", reason: "not_supervisor" };

  it("lets the trusted peer in with system-admin among the groups", () => {
    for (const groups of [
      "system-admin",
      "system-users,system-admin",
      "system-admin,system-users",
      " system-admin ",
      "system-users , system-admin",
    ]) {
      expect([groups, auth.check({ peer: "172.30.32.2", groups })]).toEqual([groups, allowed]);
    }
  });

  it("takes an IPv4-mapped IPv6 peer for its IPv4 address", () => {
    expect(auth.check({ peer: "::ffff:172.30.32.2", groups: "system-admin" })).toEqual(allowed);
    expect(auth.check({ peer: "::FFFF:172.30.32.2", groups: "system-admin" })).toEqual(allowed);
  });

  it("compares IPv6 peers in their canonical form", () => {
    const v6 = createIngressAdminAuth({ peer: "FD00:0:0:0:0:0:0:2" });
    expect(v6.check({ peer: "fd00::2", groups: "system-admin" })).toEqual(allowed);
    expect(v6.check({ peer: "fd00::3", groups: "system-admin" })).toEqual(notSupervisor);
  });

  it("denies every other peer, however valid the headers, and says nothing about the groups", () => {
    for (const peer of [
      "172.30.32.1",
      "172.30.32.20",
      "172.30.33.2",
      "127.0.0.1",
      "::1",
      "",
      "x",
    ]) {
      expect([peer, auth.check({ peer, groups: "system-admin" })]).toEqual([peer, notSupervisor]);
      expect([peer, auth.check({ peer, groups: undefined })]).toEqual([peer, notSupervisor]);
    }
    expect(auth.check({ peer: undefined, groups: "system-admin" })).toEqual(notSupervisor);
  });

  it("denies the trusted peer without system-admin", () => {
    for (const groups of [
      undefined,
      "",
      " ",
      ",",
      "system-users",
      "SYSTEM-ADMIN",
      "System-Admin",
      "system-administrator",
      "system-admin2",
      "xsystem-admin",
      "system-admins,system-users",
      "system admin",
      "system-admin;system-users",
    ]) {
      expect([groups, auth.check({ peer: "172.30.32.2", groups })]).toEqual([groups, notAdmin]);
    }
  });

  it("is a session-less AdminAuth: no token, no session of its own, one internal marker", () => {
    expect(auth.checkToken("anything")).toBe(false);
    expect(auth.checkToken("")).toBe(false);
    expect(() => auth.startSession(new Date())).toThrow("no sessions");
    expect(auth.hasSession(auth.session, new Date())).toBe(true);
    expect(auth.hasSession("", new Date())).toBe(false);
    expect(auth.hasSession("system-admin", new Date())).toBe(false);
    // Another instance's marker means nothing here.
    expect(
      auth.hasSession(createIngressAdminAuth({ peer: "172.30.32.2" }).session, new Date()),
    ).toBe(false);
  });
});
