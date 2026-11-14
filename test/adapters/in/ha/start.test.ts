// The Home Assistant start step (decision D57), with the privileged parts faked: the order is what
// matters (read the options as root, prepare the directories as root, ask the Supervisor as root,
// only then drop, verify and serve with the "version verified" flag; decision I75).
import { describe, expect, it } from "vite-plus/test";
import { FIXED_ENVIRONMENT } from "../../../../src/adapters/in/ha/options.ts";
import {
  HA_DIRECTORIES,
  type HaStartPorts,
  type HaSupervisorEndpoint,
  haStart,
  parsePasswd,
} from "../../../../src/adapters/in/ha/start.ts";

const OPTIONS = JSON.stringify({
  base_url: "https://runs.example.org",
  smtp_password: "TOPSECRET-smtp",
  admin_token: "x".repeat(40),
});

function fakes(overrides: Partial<HaStartPorts> = {}) {
  const events: string[] = [];
  const served: { env: Record<string, string | undefined>; options: unknown }[] = [];
  const asked: { endpoint: HaSupervisorEndpoint; root: boolean }[] = [];
  let dropped = false;
  const ports: HaStartPorts = {
    readOptionsFile: async () => {
      events.push("read");
      return OPTIONS;
    },
    findRunUser: async () => {
      events.push("find-user");
      return { uid: 1000, gid: 1000 };
    },
    prepareDirectories: async (user, directories) => {
      events.push(`prepare ${user.uid}:${user.gid} ${directories.map((d) => d.path).join(",")}`);
    },
    supervisorVersion: async (endpoint) => {
      events.push(`ask ${endpoint.socketPath !== undefined ? "socket" : "tcp"}`);
      asked.push({ endpoint, root: !dropped });
      return "2026.10.4";
    },
    dropPrivileges: (user) => {
      events.push(`drop ${user.uid}:${user.gid}`);
      dropped = true;
    },
    restrictUmask: () => {
      events.push("umask");
    },
    identity: () => {
      events.push("identity");
      return dropped
        ? { uid: 1000, euid: 1000, gid: 1000, egid: 1000, groups: [1000] }
        : { uid: 0, euid: 0, gid: 0, egid: 0, groups: [0] };
    },
    canRegainRoot: () => {
      events.push("regain");
      return false;
    },
    serve: async (env, options) => {
      events.push("serve");
      served.push({ env: { ...env }, options });
    },
    environment: {
      SUPERVISOR_TOKEN: "sup-token",
      SUPERVISOR_SOCKET: "/run/supervisor/api/supervisor.sock",
      ADMIN_TOKEN: "x".repeat(40),
      PATH: "/usr/bin",
    },
    ...overrides,
  };
  return { ports, events, served, asked };
}

describe("the start step", () => {
  it("reads, prepares, asks the Supervisor as root, drops, verifies and serves, in that order", async () => {
    const { ports, events } = fakes();
    expect(await haStart(ports)).toEqual({ ok: true });
    expect(events).toEqual([
      "read",
      "find-user",
      "prepare 1000:1000 /data,/config,/config/keys",
      "ask socket",
      "drop 1000:1000",
      "identity",
      "regain",
      "umask",
      "serve",
    ]);
  });

  it("serves with the mapped configuration and nothing of the Supervisor's", async () => {
    const { ports, served } = fakes();
    await haStart(ports);
    expect(served).toEqual([
      {
        env: {
          BASE_URL: "https://runs.example.org",
          SMTP_PASSWORD: "TOPSECRET-smtp",
          ...FIXED_ENVIRONMENT,
        },
        options: { ingressVersionVerified: true },
      },
    ]);
  });

  it("keeps the token, the socket and the process environment out of the server", async () => {
    const { ports, served } = fakes();
    await haStart(ports);
    const env = served[0]?.env ?? {};
    expect(env.SUPERVISOR_TOKEN).toBeUndefined();
    expect(env.SUPERVISOR_SOCKET).toBeUndefined();
    expect(env.SUPERVISOR_URL).toBeUndefined();
    expect(env.ADMIN_TOKEN).toBeUndefined();
    expect(env.PATH).toBeUndefined();
  });

  it("asks over the socket when both are present, with the Supervisor's whole check as root", async () => {
    const { ports, asked } = fakes();
    await haStart(ports);
    expect(asked).toEqual([
      { endpoint: { socketPath: "/run/supervisor/api/supervisor.sock" }, root: true },
    ]);
  });

  it("asks over TCP with the token when there is no socket, at the default URL", async () => {
    const { ports, asked, events } = fakes({ environment: { SUPERVISOR_TOKEN: "sup-token" } });
    expect(await haStart(ports)).toEqual({ ok: true });
    expect(asked).toEqual([
      { endpoint: { url: "http://supervisor", token: "sup-token" }, root: true },
    ]);
    expect(events.indexOf("ask tcp")).toBeLessThan(events.indexOf("drop 1000:1000"));
  });

  it("takes SUPERVISOR_URL for TCP, and refuses one that is not an http origin", async () => {
    const env = { SUPERVISOR_TOKEN: "sup-token", SUPERVISOR_URL: "http://10.0.0.2:4000" };
    const { ports, asked } = fakes({ environment: env });
    await haStart(ports);
    expect(asked[0]?.endpoint).toEqual({ url: "http://10.0.0.2:4000", token: "sup-token" });
    for (const url of ["ftp://x", "not a url", "http://u:p@host", "http://host/path"]) {
      const bad = fakes({ environment: { ...env, SUPERVISOR_URL: url } });
      expect((await haStart(bad.ports)).ok).toBe(false);
      expect(bad.events.some((e) => e.startsWith("drop") || e === "serve")).toBe(false);
    }
  });

  it("stops before the drop when it has neither a socket nor a token", async () => {
    for (const environment of [{}, { SUPERVISOR_TOKEN: "", SUPERVISOR_SOCKET: "" }]) {
      const { ports, events } = fakes({ environment });
      const result = await haStart(ports);
      expect(result).toEqual({ ok: false, message: expect.stringContaining("SUPERVISOR_TOKEN") });
      expect(events.some((e) => e.startsWith("ask") || e.startsWith("drop"))).toBe(false);
      expect(events).not.toContain("serve");
    }
  });

  it("a relative socket path is refused", async () => {
    const { ports, events } = fakes({ environment: { SUPERVISOR_SOCKET: "supervisor.sock" } });
    expect((await haStart(ports)).ok).toBe(false);
    expect(events.some((e) => e.startsWith("ask") || e.startsWith("drop"))).toBe(false);
  });

  it("a version at or above 2026.10.4 passes, also a newer year", async () => {
    for (const version of ["2026.10.4", "2026.11.0", "2027.1.0"]) {
      const { ports, events } = fakes({ supervisorVersion: async () => version });
      expect(await haStart(ports)).toEqual({ ok: true });
      expect(events).toContain("serve");
    }
  });

  it("fails closed before the drop and never serves: too old, dev, unparsable, unreachable", async () => {
    const answers: [() => Promise<string>, string][] = [
      [async () => "2026.10.3", "found 2026.10.3"],
      [async () => "dev", "cannot be compared"],
      [async () => "banana", "cannot be compared"],
      [
        async () => {
          throw new Error("connect ECONNREFUSED 172.30.32.2:80, ECONNREFUSED");
        },
        "ECONNREFUSED",
      ],
      [
        async () => {
          throw new Error("the Supervisor answered HTTP 401");
        },
        "HTTP 401",
      ],
    ];
    for (const [supervisorVersion, text] of answers) {
      const { ports, events } = fakes({ supervisorVersion });
      const result = await haStart(ports);
      if (result.ok) throw new Error("started");
      expect(result.message).toContain(text);
      expect(result.message).toContain("Ingress mode");
      expect(result.message).not.toContain("sup-token");
      expect(result.message).not.toContain("ADMIN_INGRESS_SKIP_VERSION_CHECK");
      // The choice: the check comes first, so a failure never reaches the drop (and the process
      // exits as root without ever serving).
      expect(events.some((e) => e.startsWith("drop") || e === "serve" || e === "identity")).toBe(
        false,
      );
    }
  });

  it("hints at hassio_api for a 403 and not for other failures", async () => {
    const forbidden = fakes({
      supervisorVersion: async () => {
        throw new Error("the Supervisor answered HTTP 403");
      },
    });
    const result = await haStart(forbidden.ports);
    if (result.ok) throw new Error("started");
    expect(result.message).toContain("hassio_api: true");
    expect(forbidden.events).not.toContain("serve");

    const refused = fakes({
      supervisorVersion: async () => {
        throw new Error("the Supervisor answered HTTP 401");
      },
    });
    const other = await haStart(refused.ports);
    if (other.ok) throw new Error("started");
    expect(other.message).not.toContain("hassio_api");
  });

  const hostileOptions = JSON.stringify({
    base_url: "https://runs.example.org",
    ingress_version_verified: true,
    ingressVersionVerified: true,
    admin_ingress_version_verified: true,
  });
  const hostileEnvironment = {
    SUPERVISOR_TOKEN: "sup-token",
    INGRESS_VERSION_VERIFIED: "true",
    ADMIN_INGRESS_VERSION_VERIFIED: "true",
    ingressVersionVerified: "true",
  };

  it("the verified flag served is exactly haStart's own, whatever the options and environment say", async () => {
    const good = fakes({
      readOptionsFile: async () => hostileOptions,
      environment: hostileEnvironment,
    });
    expect(await haStart(good.ports)).toEqual({ ok: true });
    expect(good.served[0]?.options).toEqual({ ingressVersionVerified: true });
    expect(Object.keys(good.served[0]?.env ?? {}).filter((k) => /VERIFIED/i.test(k))).toEqual([]);
  });

  it("hostile options and environment do not get an old Supervisor served", async () => {
    const old = fakes({
      readOptionsFile: async () => hostileOptions,
      environment: hostileEnvironment,
      supervisorVersion: async () => "2026.10.3",
    });
    expect((await haStart(old.ports)).ok).toBe(false);
    expect(old.events).not.toContain("serve");
    expect(old.served).toEqual([]);
  });

  it("directories: /data and the keys are private, /config is not recursive", () => {
    expect(HA_DIRECTORIES).toEqual([
      { path: "/data", mode: 0o700, recursive: true, skip: ["/data/options.json"] },
      { path: "/config", mode: undefined, recursive: false, skip: [] },
      { path: "/config/keys", mode: 0o700, recursive: true, skip: [] },
    ]);
    expect(FIXED_ENVIRONMENT.ENCRYPTION_KEY_FILE?.startsWith("/config/keys/")).toBe(true);
    expect(FIXED_ENVIRONMENT.DATA_DIR).toBe("/data");
  });

  it("stops before anything else when the options file cannot be read", async () => {
    const { ports, events } = fakes({
      readOptionsFile: async () => {
        events.push("read");
        throw new Error("ENOENT: /data/options.json");
      },
    });
    const result = await haStart(ports);
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("/data/options.json"),
    });
    expect(events).toEqual(["read"]);
  });

  it("stops on options that are not JSON, without echoing them", async () => {
    const { ports, events } = fakes({ readOptionsFile: async () => '{"smtp_password": TOPSECRET' });
    const result = await haStart(ports);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("TOPSECRET");
    expect(events).not.toContain("drop 1000:1000");
  });

  it("stops on option errors, naming the option and not the value", async () => {
    const { ports, events } = fakes({
      readOptionsFile: async () => JSON.stringify({ smtp_password: 12345, smtp_port: "TOPSECRET" }),
    });
    const result = await haStart(ports);
    const text = JSON.stringify(result);
    expect(result.ok).toBe(false);
    expect(text).toContain("smtp_password");
    expect(text).toContain("smtp_port");
    expect(text).not.toContain("TOPSECRET");
    expect(text).not.toContain("12345");
    expect(events).toEqual([]);
  });

  it("stops when the run user does not exist", async () => {
    const { ports, events } = fakes({ findRunUser: async () => undefined });
    expect((await haStart(ports)).ok).toBe(false);
    expect(events.some((event) => event.startsWith("prepare") || event === "serve")).toBe(false);
  });

  it("stops when the directories cannot be prepared, before the drop", async () => {
    const { ports, events } = fakes({
      prepareDirectories: async () => {
        throw new Error("EROFS: /config");
      },
    });
    const result = await haStart(ports);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("/config") });
    expect(events).not.toContain("serve");
    expect(events.some((event) => event.startsWith("drop") || event.startsWith("ask"))).toBe(false);
  });

  it("does not serve when dropping fails", async () => {
    const { ports, events } = fakes({
      dropPrivileges: () => {
        throw new Error("EPERM");
      },
    });
    expect((await haStart(ports)).ok).toBe(false);
    expect(events).not.toContain("serve");
  });

  it("does not serve when the identity is not the run user's after the drop", async () => {
    for (const identity of [
      { uid: 0, euid: 0, gid: 1000, egid: 1000, groups: [1000] },
      { uid: 1000, euid: 0, gid: 1000, egid: 1000, groups: [1000] },
      { uid: 1000, euid: 1000, gid: 0, egid: 1000, groups: [1000] },
      { uid: 1000, euid: 1000, gid: 1000, egid: 0, groups: [1000] },
      { uid: 1000, euid: 1000, gid: 1000, egid: 1000, groups: [1000, 0] },
    ]) {
      const { ports, events } = fakes({ identity: () => identity });
      const result = await haStart(ports);
      expect(result.ok).toBe(false);
      expect(events).not.toContain("serve");
    }
  });

  it("does not serve when root can be regained", async () => {
    const { ports, events } = fakes({ canRegainRoot: () => true });
    const result = await haStart(ports);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("privileges") });
    expect(events).not.toContain("serve");
  });

  it("reports a server that fails to start", async () => {
    const { ports } = fakes({
      serve: async () => {
        throw new Error("EADDRINUSE");
      },
    });
    expect(await haStart(ports)).toEqual({
      ok: false,
      message: expect.stringContaining("EADDRINUSE"),
    });
  });
});

describe("finding the run user", () => {
  const passwd = [
    "root:x:0:0:root:/root:/bin/bash",
    "# comment",
    "",
    "node:x:1000:1001::/home/node:/bin/bash",
    "nodeish:x:1002:1002::/h:/bin/sh",
  ].join("\n");

  it("reads uid and gid of the named user", () => {
    expect(parsePasswd(passwd, "node")).toEqual({ uid: 1000, gid: 1001 });
  });

  it("is undefined for an unknown user or a malformed line", () => {
    expect(parsePasswd(passwd, "nobody")).toBeUndefined();
    expect(parsePasswd("node:x:abc:def::/:/bin/sh", "node")).toBeUndefined();
    expect(parsePasswd("node:x:0:0::/:/bin/sh", "node")).toBeUndefined();
  });
});
