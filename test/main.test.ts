import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import {
  createServer as createHttpServer,
  request as httpRequest,
  type ServerResponse,
} from "node:http";
import { createServer, createConnection } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import BetterSqlite3 from "better-sqlite3";
import { runApplyRetentionMax, runBackup, type RunningServer, startServer } from "../src/main.ts";
import { TestClient } from "./support/client.ts";
import { createPlanViaUi, respondViaUi } from "./support/plans.ts";

const running: RunningServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): Record<string, string> {
  const dataDir = mkdtempSync(join(tmpdir(), "rendezroute-main-"));
  dirs.push(dataDir);
  return {
    BASE_URL: "https://runs.example.org",
    CONTACT_EMAIL: "owner@example.org",
    DATA_DIR: dataDir,
    ...extra,
  };
}

/** A key directory outside DATA_DIR, as spec 3.11 recommends. */
function keyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rendezroute-keys-"));
  dirs.push(dir);
  return dir;
}

async function start(vars: Record<string, string>) {
  const result = await startServer(vars, { port: 0, hostname: "127.0.0.1" });
  if (result.ok) running.push(result.server);
  return result;
}

describe("startServer", () => {
  it("serves /healthz on a real socket", async () => {
    const result = await start(env());
    if (!result.ok) throw new Error(result.errors.join("; "));
    const response = await fetch(new URL("/healthz", result.server.url));
    expect(response.status).toBe(200);
  });

  it("refuses to start with invalid configuration and returns every error", async () => {
    const result = await start({ BASE_URL: "http://runs.example.org", MAX_RETENTION_DAYS: "45" });
    expect(result).toEqual({ ok: false, errors: [expect.any(String), expect.any(String)] });
  });

  it("warns when the key falls back to DATA_DIR and when CONTACT_EMAIL is missing", async () => {
    const vars = env();
    delete vars.CONTACT_EMAIL;
    const result = await start(vars);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.warnings).toEqual([
      expect.stringContaining("CONTACT_EMAIL"),
      expect.stringContaining("Backups of DATA_DIR"),
    ]);
  });
});

describe("encryption key handling at startup (spec 3.11)", () => {
  it("generates a key on first start and reuses it afterwards", async () => {
    const vars = env();
    const keyFile = join(keyDir(), "field.key");
    vars.ENCRYPTION_KEY_FILE = keyFile;

    const first = await start(vars);
    if (!first.ok) throw new Error(first.errors.join("; "));
    expect(first.warnings).toEqual([]);
    await running.pop()?.close();

    const second = await start(vars);
    expect(second.ok).toBe(true);
  });

  it("keeps the VAPID and federation signing keys in the key directory, never elsewhere in DATA_DIR (spec 2b)", async () => {
    const vars = env();
    const keys = keyDir();
    vars.ENCRYPTION_KEY_FILE = join(keys, "field.key");
    const result = await start(vars);
    if (!result.ok) throw new Error(result.errors.join("; "));

    expect(statSync(join(keys, "vapid.json")).mode & 0o777).toBe(0o600);
    // The instance actor's signing keys too (decision D36).
    expect(statSync(join(keys, "federation-instance.json")).mode & 0o777).toBe(0o600);
    const dataFiles = readdirSync(vars.DATA_DIR ?? "", { recursive: true }).map(String);
    expect(dataFiles.filter((name) => /vapid|federation/.test(name))).toEqual([]);
  });

  it("refuses to start when the key does not match the database", async () => {
    const vars = env();
    const keyFile = join(keyDir(), "field.key");
    vars.ENCRYPTION_KEY_FILE = keyFile;
    const first = await start(vars);
    if (!first.ok) throw new Error(first.errors.join("; "));
    await running.pop()?.close();

    writeFileSync(keyFile, `1:${Buffer.alloc(32, 7).toString("base64")}\n`);
    const second = await start(vars);
    expect(second).toEqual({ ok: false, errors: [expect.stringContaining("does not match")] });
  });
});

/** Inserts a plan directly, as if stored before downtime (no encrypted fields needed). */
function insertPlan(dataDir: string, id: string, retentionDays: number, deleteAt: string) {
  const db = new BetterSqlite3(join(dataDir, "rendezroute.db"));
  const t = "2026-01-01T00:00:00.000Z";
  db.prepare(
    `insert into plans (id, poster_name, poster_language, activity_type, title, starts_at, timezone, area_label,
      drop_policy, recap_window, retention_days, delete_at, host_token_hash, created_at, updated_at)
     values (?, 'Anna', 'en', 'run', 'Run', ?, 'UTC', 'Park', 'no_drop', '1d', ?, ?, ?, ?, ?)`,
  ).run(id, "2026-01-01T08:00:00.000Z", retentionDays, deleteAt, `hash-${id}`, t, t);
  db.close();
}

describe("retention at startup (spec 3.10: sweep at startup)", () => {
  it("deletes plans past their deletion date before serving", async () => {
    const vars = env();
    const first = await start(vars);
    if (!first.ok) throw new Error(first.errors.join("; "));
    await running.pop()?.close();
    insertPlan(vars.DATA_DIR ?? "", "expired", 1, "2026-01-02T08:00:00.000Z");
    insertPlan(vars.DATA_DIR ?? "", "future", 1, "2999-01-01T00:00:00.000Z");

    const second = await start(vars);
    if (!second.ok) throw new Error(second.errors.join("; "));
    const db = new BetterSqlite3(join(vars.DATA_DIR ?? "", "rendezroute.db"), { readonly: true });
    expect(db.prepare("select id from plans order by id").pluck().all()).toEqual(["future"]);
    db.close();
  });
});

describe("apply-retention-max (spec 3.10)", () => {
  it("applies a lowered maximum to existing plans and reports what changed", async () => {
    const vars = env();
    const first = await start(vars);
    if (!first.ok) throw new Error(first.errors.join("; "));
    await running.pop()?.close();
    insertPlan(vars.DATA_DIR ?? "", "long", 30, "2999-01-31T08:00:00.000Z");
    insertPlan(vars.DATA_DIR ?? "", "short", 2, "2999-01-03T08:00:00.000Z");

    const result = await runApplyRetentionMax({ ...vars, MAX_RETENTION_DAYS: "7" });
    // The key falls back to DATA_DIR in this test, so the CLI must report that warning too.
    expect(result).toEqual({
      ok: true,
      shortened: 0,
      deleted: 1,
      warnings: [expect.stringContaining("DATA_DIR")],
    });
  });

  it("refuses to run with invalid configuration", async () => {
    expect(await runApplyRetentionMax({ BASE_URL: "nope" })).toMatchObject({ ok: false });
  });
});

describe("backup (spec 11: the database via SQLite's online backup API)", () => {
  it("copies the live database while the server runs, readable only by its owner", async () => {
    const vars = env();
    const server = await start(vars);
    if (!server.ok) throw new Error(server.errors.join("; "));
    insertPlan(vars.DATA_DIR ?? "", "kept", 1, "2999-01-01T00:00:00.000Z");
    const target = keyDir();

    const result = await runBackup(vars, target);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const files = readdirSync(target);
    expect(files).toEqual([expect.stringMatching(/^rendezroute-\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/)]);
    expect(result.path).toBe(join(target, files[0] ?? ""));
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
    const copy = new BetterSqlite3(result.path, { readonly: true });
    expect(copy.prepare("select id from plans").pluck().all()).toEqual(["kept"]);
    copy.close();
  });

  it("refuses a missing database or a relative target", async () => {
    const vars = env();
    expect(await runBackup(vars, keyDir())).toEqual({
      ok: false,
      errors: [expect.stringContaining("No database")],
    });
    expect(await runBackup(vars, "relative/dir")).toEqual({
      ok: false,
      errors: [expect.stringContaining("absolute")],
    });
  });
});

/** A port nobody listens on right now. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

/** Whether something accepts connections at this address. */
const accepts = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

/** An address of this machine that is not loopback, if it has one. */
const lanAddress = () =>
  Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;

const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";

describe("the public listener's hostname option", () => {
  it("binds only that address when given, and every address otherwise", async () => {
    const lan = lanAddress();
    const bound = await start(env());
    if (!bound.ok) throw new Error(bound.errors.join("; "));
    const boundPort = Number(bound.server.url.port);
    expect((await fetch(new URL("/healthz", bound.server.url))).status).toBe(200);
    expect(await accepts("127.0.0.1", boundPort)).toBe(true);
    expect(lan === undefined ? false : await accepts(lan, boundPort)).toBe(false);
    expect(await accepts("::1", boundPort)).toBe(false);
    await running.pop()?.close();

    // Production passes no hostname: the wildcard answers on every address of the machine.
    const port = await freePort();
    const wide = await startServer(env(), { port });
    if (!wide.ok) throw new Error(wide.errors.join("; "));
    running.push(wide.server);
    expect(await accepts("127.0.0.1", port)).toBe(true);
    expect(lan === undefined ? true : await accepts(lan, port)).toBe(true);
  });
});

describe("the admin listener (decision D55)", () => {
  async function startSplit(extra: Record<string, string> = {}, options: { port?: number } = {}) {
    const adminPort = await freePort();
    const result = await startServer(
      env({ ADMIN_TOKEN, ADMIN_PORT: String(adminPort), ...extra }),
      { port: options.port ?? 0, hostname: "127.0.0.1" },
    );
    if (result.ok) running.push(result.server);
    return { result, adminPort };
  }

  it("has no second listener without ADMIN_PORT", async () => {
    const result = await start(env({ ADMIN_TOKEN }));
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.server.adminUrl).toBeUndefined();
    expect(result.server.adminAddress).toBeUndefined();
    expect((await fetch(new URL("/admin/login", result.server.url))).status).toBe(200);
  });

  it("serves the admin pages on the second port and answers 404 on /admin on the first", async () => {
    const { result, adminPort } = await startSplit();
    if (!result.ok) throw new Error(result.errors.join("; "));
    const adminUrl = result.server.adminUrl;
    expect(adminUrl?.href).toBe(`http://127.0.0.1:${adminPort}/`);
    expect(result.server.adminAddress).toBe(`127.0.0.1:${adminPort}`);
    expect((await fetch(new URL("/admin/login", result.server.url))).status).toBe(404);
    expect((await fetch(new URL("/admin/login", adminUrl))).status).toBe(200);
    expect((await fetch(new URL("/healthz", adminUrl))).status).toBe(200);
    expect((await fetch(new URL("/healthz", result.server.url))).status).toBe(200);
    // The listener's root leads to the admin home (relative, so Ingress can open it).
    const root = await fetch(new URL("/", adminUrl), { redirect: "manual" });
    expect(root.status).toBe(303);
    expect(root.headers.get("location")).toBe("admin/");
    expect((await fetch(new URL("/nearby", adminUrl))).status).toBe(404);
  });

  it("binds ADMIN_BIND: loopback by default, other addresses only when asked", async () => {
    const lan = lanAddress();
    const closed = await startSplit();
    if (!closed.result.ok) throw new Error(closed.result.errors.join("; "));
    expect(await accepts("127.0.0.1", closed.adminPort)).toBe(true);
    expect(lan === undefined ? false : await accepts(lan, closed.adminPort)).toBe(false);
    await running.pop()?.close();

    const open = await startSplit({ ADMIN_BIND: "0.0.0.0" });
    if (!open.result.ok) throw new Error(open.result.errors.join("; "));
    expect(open.result.server.adminUrl?.hostname).toBe("127.0.0.1");
    expect(await accepts("127.0.0.1", open.adminPort)).toBe(true);
    expect(lan === undefined ? true : await accepts(lan, open.adminPort)).toBe(true);
  });

  it("keeps the CSRF keys of the two listeners apart (real keys from the keyring)", async () => {
    const { result, adminPort } = await startSplit();
    if (!result.ok) throw new Error(result.errors.join("; "));
    const adminOrigin = `http://127.0.0.1:${adminPort}`;

    /** The CSRF cookie (name and value) and form token a page issued. */
    const issued = async (url: URL) => {
      const response = await fetch(url);
      const cookie = /^([^=]+)=([^;]+)/.exec(response.headers.getSetCookie()[0] ?? "");
      const token = /name="_csrf" value="([^"]+)"/.exec(await response.text())?.[1];
      if (cookie?.[1] === undefined || cookie[2] === undefined || token === undefined) {
        throw new Error(`no CSRF token from ${url.href}`);
      }
      return { name: cookie[1], value: cookie[2], token };
    };
    const login = (cookie: string, token: string) =>
      fetch(new URL("/admin/login", adminOrigin), {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: adminOrigin,
          cookie,
        },
        body: new URLSearchParams({ _csrf: token, token: ADMIN_TOKEN }).toString(),
      });

    // A public page's cookie and token, offered to the admin listener under both cookie names.
    const publicPage = await issued(new URL("/privacy", result.server.url));
    expect(publicPage.name).toBe("__Host-rr-csrf");
    for (const name of ["rr-admin-csrf", publicPage.name]) {
      const response = await login(
        `${name}=${publicPage.value}; ${publicPage.name}=${publicPage.value}`,
        publicPage.token,
      );
      expect([name, response.status]).toEqual([name, 403]);
    }

    // Control: the admin listener's own cookie and token reach the login handler.
    const own = await issued(new URL("/admin/login", adminOrigin));
    expect(own.name).toBe("rr-admin-csrf");
    const accepted = await login(`${own.name}=${own.value}`, own.token);
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("location")).toBe("../admin/");
  });

  it("closes both listeners together", async () => {
    const { result, adminPort } = await startSplit();
    if (!result.ok) throw new Error(result.errors.join("; "));
    const publicPort = Number(result.server.url.port);
    expect(await accepts("127.0.0.1", publicPort)).toBe(true);
    expect(await accepts("127.0.0.1", adminPort)).toBe(true);
    await running.pop()?.close();
    expect(await accepts("127.0.0.1", publicPort)).toBe(false);
    expect(await accepts("127.0.0.1", adminPort)).toBe(false);
  });

  it("fails cleanly when the admin port is in use, without leaving the public listener up", async () => {
    const publicPort = await freePort();
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const address = taken.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    try {
      const result = await startServer(env({ ADMIN_TOKEN, ADMIN_PORT: String(address.port) }), {
        port: publicPort,
        hostname: "127.0.0.1",
      });
      if (result.ok) running.push(result.server);
      expect(result).toEqual({
        ok: false,
        kind: "listen",
        errors: [expect.stringContaining("ADMIN_PORT")],
      });
      expect(result.ok ? "" : (result.errors[0] ?? "")).toContain("in use");
      expect(await accepts("127.0.0.1", publicPort)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => taken.close(() => resolve()));
    }
  });

  it("says so when the ADMIN_BIND host name does not resolve", async () => {
    const publicPort = await freePort();
    const result = await startServer(
      env({
        ADMIN_TOKEN,
        ADMIN_PORT: String(await freePort()),
        ADMIN_BIND: "no-such-host.invalid",
      }),
      { port: publicPort, hostname: "127.0.0.1" },
    );
    if (result.ok) running.push(result.server);
    expect(result.ok).toBe(false);
    const message = result.ok ? "" : (result.errors[0] ?? "");
    expect(message).toContain("no-such-host.invalid");
    expect(message).toContain("ADMIN_BIND");
    expect(message).toContain("does not resolve");
    expect(message).toContain("only its first address");
    expect(await accepts("127.0.0.1", publicPort)).toBe(false);
  });

  it("says to check ADMIN_BIND when its address does not belong to this machine", async () => {
    const publicPort = await freePort();
    const result = await startServer(
      env({ ADMIN_TOKEN, ADMIN_PORT: String(await freePort()), ADMIN_BIND: "203.0.113.1" }),
      { port: publicPort, hostname: "127.0.0.1" },
    );
    if (result.ok) running.push(result.server);
    expect(result.ok).toBe(false);
    const message = result.ok ? "" : (result.errors[0] ?? "");
    expect(message).toContain("203.0.113.1");
    expect(message).toContain("does not belong to this machine");
    expect(message).toContain("Check ADMIN_BIND.");
    expect(await accepts("127.0.0.1", publicPort)).toBe(false);
  });

  it("refuses an admin port equal to the public port", async () => {
    const port = await freePort();
    const result = await startServer(env({ ADMIN_TOKEN, ADMIN_PORT: String(port) }), {
      port,
      hostname: "127.0.0.1",
    });
    if (result.ok) running.push(result.server);
    expect(result).toEqual({
      ok: false,
      errors: [expect.stringContaining("ADMIN_PORT must differ from the public port")],
    });
  });
});

describe("Home Assistant Ingress on the admin listener (decision D56)", () => {
  const fakes: ReturnType<typeof createHttpServer>[] = [];
  afterEach(async () => {
    for (const fake of fakes.splice(0)) {
      fake.closeAllConnections();
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
  });

  /** A fake Supervisor on a free 127.0.0.1 port; `seen` collects the calls it received. */
  async function fakeSupervisor(
    answer: (response: ServerResponse) => void,
  ): Promise<{ url: string; seen: { path?: string; auth?: string }[] }> {
    const seen: { path?: string; auth?: string }[] = [];
    const fake = createHttpServer((request, response) => {
      seen.push({ path: request.url ?? "", auth: request.headers.authorization ?? "" });
      answer(response);
    });
    fakes.push(fake);
    await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
    const address = fake.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    return { url: `http://127.0.0.1:${address.port}`, seen };
  }
  const versionOf = (version: string) => (response: ServerResponse) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ result: "ok", data: { version } }));
  };

  async function startIngress(
    supervisorUrl: string,
    extra: Record<string, string> = {},
  ): Promise<{ result: Awaited<ReturnType<typeof start>>; adminPort: number }> {
    const adminPort = await freePort();
    const result = await start(
      env({
        ADMIN_INGRESS: "true",
        ADMIN_PORT: String(adminPort),
        ADMIN_BIND: "127.0.0.1",
        ADMIN_INGRESS_PEER: "127.0.0.1",
        SUPERVISOR_URL: supervisorUrl,
        SUPERVISOR_TOKEN: "the-supervisor-token",
        POSTING_MODE: "invite",
        ...extra,
      }),
    );
    return { result, adminPort };
  }

  /** A raw request, so the header names keep their letter case on the wire. */
  function raw(url: URL, headers: Record<string, string>, method = "GET", body?: string) {
    return new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      body: string;
    }>((resolve, reject) => {
      const request = httpRequest(url, { method, headers }, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (text += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text }),
        );
      });
      request.on("error", reject);
      request.end(body);
    });
  }

  it("asks the Supervisor, starts, and serves /admin/ to the trusted peer's admin", async () => {
    const supervisor = await fakeSupervisor(versionOf("2026.10.4"));
    const { result, adminPort } = await startIngress(supervisor.url);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(supervisor.seen).toEqual([
      { path: "/supervisor/info", auth: "Bearer the-supervisor-token" },
    ]);
    expect(result.server.adminAddress).toBe(`127.0.0.1:${adminPort}`);
    expect(result.server.adminIngressPeer).toBe("127.0.0.1");
    const admin = result.server.adminUrl;
    if (admin === undefined) throw new Error("no admin listener");

    // Header names are case-insensitive on the wire; the Supervisor's own spelling and others work.
    for (const name of ["X-Remote-User-Groups", "x-remote-user-groups", "X-REMOTE-USER-GROUPS"]) {
      const page = await raw(new URL("/admin/", admin), {
        [name]: "system-users,system-admin",
        "x-remote-user-id": "user-a",
      });
      expect([name, page.status]).toEqual([name, 200]);
      expect(page.headers["set-cookie"]).toBeUndefined();
      expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    }
    const withoutGroups = await raw(new URL("/admin/", admin), {});
    expect(withoutGroups.status).toBe(403);
    expect(withoutGroups.body).toContain("2026.10.4");
    const withoutUser = await raw(new URL("/admin/", admin), {
      "x-remote-user-groups": "system-admin",
    });
    expect(withoutUser.status).toBe(403);
    expect(withoutUser.body).toContain("2026.10.4");

    // The admin pages are not on the public port.
    expect((await fetch(new URL("/admin/", result.server.url))).status).toBe(404);

    // A form post, as the browser sends it through the Supervisor: the token from the page, no cookie.
    const identity = { "x-remote-user-groups": "system-admin", "x-remote-user-id": "user-a" };
    const home = await raw(new URL("/admin/", admin), identity);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(home.body)?.[1] ?? "";
    expect(csrf).not.toBe("");
    const find = (headers: Record<string, string>, token: string) =>
      raw(
        new URL("/admin/plans", admin),
        {
          ...identity,
          "content-type": "application/x-www-form-urlencoded",
          ...headers,
        },
        "POST",
        `plan=nonsense&_csrf=${encodeURIComponent(token)}`,
      );
    expect((await find({}, "")).status).toBe(403);
    expect((await find({ "sec-fetch-site": "cross-site", origin: "null" }, csrf)).status).toBe(403);
    expect((await find({ "sec-fetch-site": "same-origin", origin: "null" }, csrf)).status).toBe(
      422,
    );
    expect((await find({ origin: "null" }, csrf)).status).toBe(422);
  });

  it("trusts no other peer, whatever headers it sends", async () => {
    const supervisor = await fakeSupervisor(versionOf("2026.11.0"));
    const { result } = await startIngress(supervisor.url, { ADMIN_INGRESS_PEER: "172.30.32.2" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    const admin = result.server.adminUrl;
    if (admin === undefined) throw new Error("no admin listener");
    const forged = await raw(new URL("/admin/", admin), {
      "x-remote-user-groups": "system-admin",
      "x-forwarded-for": "172.30.32.2",
    });
    expect(forged.status).toBe(403);
    expect(forged.body).not.toContain("2026.10.4");
  });

  it("refuses a Supervisor that is too old, and starts nothing", async () => {
    const supervisor = await fakeSupervisor(versionOf("2026.10.3"));
    const { result, adminPort } = await startIngress(supervisor.url);
    expect(result).toEqual({
      ok: false,
      kind: "supervisor",
      errors: ["Ingress mode needs Home Assistant Supervisor 2026.10.4 or newer; found 2026.10.3."],
    });
    expect(await accepts("127.0.0.1", adminPort)).toBe(false);
  });

  it("asks the Supervisor over SUPERVISOR_SOCKET, with no token (decision D57)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rr-sock-"));
    dirs.push(dir);
    for (const [version, ok, name] of [
      ["2026.10.4", true, "a.sock"],
      ["2026.10.3", false, "b.sock"],
    ] as const) {
      const socketPath = join(dir, name);
      const seen: (string | undefined)[] = [];
      const fake = createHttpServer((request, response) => {
        seen.push(request.headers.authorization);
        versionOf(version)(response);
      });
      fakes.push(fake);
      await new Promise<void>((resolve) => fake.listen(socketPath, resolve));
      const { result } = await startIngress("http://127.0.0.1:1", {
        SUPERVISOR_URL: "",
        SUPERVISOR_SOCKET: socketPath,
        SUPERVISOR_TOKEN: "",
      });
      expect(result.ok).toBe(ok);
      expect(seen).toEqual([undefined]);
    }
  });

  it("refuses a dev, unreadable, unauthorized or redirecting Supervisor", async () => {
    const answers = [
      versionOf("dev"),
      versionOf("banana"),
      (response: ServerResponse) => {
        response.writeHead(401);
        response.end();
      },
      (response: ServerResponse) => {
        response.writeHead(302, { location: "/elsewhere" });
        response.end();
      },
    ];
    for (const answer of answers) {
      const supervisor = await fakeSupervisor(answer);
      const { result } = await startIngress(supervisor.url);
      expect(result.ok ? [] : result.errors.map((e) => e.startsWith("Ingress mode"))).toEqual([
        true,
      ]);
    }
  });

  it("says so when the Supervisor cannot be reached, and starts nothing", async () => {
    const { result, adminPort } = await startIngress(`http://127.0.0.1:${await freePort()}`);
    if (result.ok) throw new Error("started");
    expect(result.kind).toBe("supervisor");
    expect(result.errors[0]).toContain("could not ask the Supervisor");
    expect(result.errors[0]).toContain("ECONNREFUSED");
    expect(result.errors[0]).not.toContain("the-supervisor-token");
    expect(await accepts("127.0.0.1", adminPort)).toBe(false);
  });

  it("with the verified flag it neither asks nor needs the token (decision I75)", async () => {
    const supervisor = await fakeSupervisor(versionOf("2026.1.0"));
    const adminPort = await freePort();
    const ingressEnv = env({
      ADMIN_INGRESS: "true",
      ADMIN_PORT: String(adminPort),
      ADMIN_BIND: "127.0.0.1",
      ADMIN_INGRESS_PEER: "127.0.0.1",
      SUPERVISOR_URL: supervisor.url,
      POSTING_MODE: "invite",
    });
    // Without the fact: the configuration insists on the token, nothing starts.
    const refused = await start(ingressEnv);
    expect(refused.ok).toBe(false);
    const result = await startServer(ingressEnv, {
      port: 0,
      hostname: "127.0.0.1",
      ingressVersionVerified: true,
    });
    if (result.ok) running.push(result.server);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(supervisor.seen).toEqual([]);
    expect(await accepts("127.0.0.1", adminPort)).toBe(true);
  });

  it("an environment variable cannot stand in for the verified flag", async () => {
    const supervisor = await fakeSupervisor(versionOf("2026.10.3"));
    for (const name of ["INGRESS_VERSION_VERIFIED", "ADMIN_INGRESS_VERSION_VERIFIED"]) {
      // Old Supervisor: still refused after asking.
      const { result } = await startIngress(supervisor.url, { [name]: "true" });
      expect(result.ok).toBe(false);
      // No token: still a configuration error.
      const adminPort = await freePort();
      const noToken = await start(
        env({
          ADMIN_INGRESS: "true",
          ADMIN_PORT: String(adminPort),
          ADMIN_BIND: "127.0.0.1",
          [name]: "true",
        }),
      );
      expect(noToken.ok).toBe(false);
    }
    expect(supervisor.seen.length).toBe(2);
  });

  it("does not ask when the version check is skipped", async () => {
    const supervisor = await fakeSupervisor(versionOf("2026.1.0"));
    const { result } = await startIngress(supervisor.url, {
      ADMIN_INGRESS_SKIP_VERSION_CHECK: "true",
    });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(supervisor.seen).toEqual([]);
    expect(result.warnings.join(" ")).toContain("ADMIN_INGRESS_SKIP_VERSION_CHECK=true");
  });
});

describe("the end-to-end clock control (decision D87)", () => {
  const dev = { ALLOW_INSECURE_DEV: "true" };
  const ADVANCE = "/__e2e/clock/advance";

  async function startOn(extra: Record<string, string>) {
    const result = await start(env({ ...dev, ...extra }));
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.server;
  }

  const advance = (server: RunningServer, body: unknown, type = "application/json") =>
    fetch(new URL(ADVANCE, server.url), {
      method: "POST",
      headers: { "content-type": type },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  /** A browser stand-in that talks to the real socket. */
  const browser = (server: RunningServer) =>
    new TestClient({ request: (path, init) => fetch(new URL(path, server.url), init) });

  it("has no clock route in a production-like configuration, nor in development mode alone", async () => {
    for (const extra of [{}, dev]) {
      const result = await start(env(extra));
      if (!result.ok) throw new Error(result.errors.join("; "));
      // A POST without a form token is refused by the CSRF check on any unknown path alike.
      const other = await fetch(new URL("/__e2e/clock/other", result.server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ms: 1000 }),
      });
      const posted = await advance(result.server, { ms: 1000 });
      expect(posted.status).toBe(other.status);
      expect(posted.status).toBeGreaterThanOrEqual(400);
      await running.pop()?.close();
    }
  });

  it("refuses to start with the variable but without ALLOW_INSECURE_DEV", async () => {
    const result = await start(env({ E2E_CLOCK_CONTROL: "true" }));
    expect(result).toEqual({
      ok: false,
      errors: [expect.stringMatching(/E2E_CLOCK_CONTROL.*ALLOW_INSECURE_DEV/)],
    });
  });

  it("advances the clock the app reads: a plan that was open to responses has started", async () => {
    const server = await startOn({ E2E_CLOCK_CONTROL: "true" });
    const startsAt = new Date(Math.ceil((Date.now() + 120_000) / 60_000) * 60_000).toISOString();
    const host = browser(server);
    const { planId } = await createPlanViaUi(host, {
      timeZone: "UTC",
      date: startsAt.slice(0, 10),
      time: startsAt.slice(11, 16),
    });

    const before = await respondViaUi(browser(server), planId, "Ben", "joined");
    expect(before.response.status).toBe(200);
    expect(before.managePath).toBeDefined();

    // Lea opens the response form while the plan is open, and presses the button after the start.
    const lea = browser(server);
    const hidden = await lea.hiddenFields(`/p/${planId}`);
    expect(hidden).toHaveProperty("_csrf");

    const moved = await advance(server, { ms: 5 * 60_000 });
    expect(moved.status).toBe(200);
    const { now } = (await moved.json()) as { now: string };
    expect(Date.parse(now) - Date.now()).toBeGreaterThan(4 * 60_000);

    const after = await lea.postForm(`/p/${planId}/respond`, {
      ...hidden,
      displayName: "Lea",
      choice: "joined",
      requestNote: "",
    });
    expect(after.status).toBe(409);
    expect(await after.text()).not.toContain("/m/");
  });

  it("answers bad requests without moving the clock", async () => {
    const server = await startOn({ E2E_CLOCK_CONTROL: "true" });
    for (const type of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
    ]) {
      expect((await advance(server, { ms: 1000 }, type)).status).toBe(415);
    }
    expect((await advance(server, "not json")).status).toBe(400);
    expect((await advance(server, {})).status).toBe(400);
    expect((await advance(server, { ms: "60000" })).status).toBe(400);
    expect((await advance(server, { ms: -1 })).status).toBe(400);
    expect((await advance(server, { ms: 25 * 60 * 60 * 1000 })).status).toBe(400);
    const read = await advance(server, { ms: 0 });
    const { now } = (await read.json()) as { now: string };
    expect(Math.abs(Date.parse(now) - Date.now())).toBeLessThan(5_000);
  });

  it("has no clock route on the admin listener, with the control on or off", async () => {
    for (const control of [{ E2E_CLOCK_CONTROL: "true" }, {}]) {
      const adminPort = await freePort();
      const result = await start(
        env({ ...dev, ...control, ADMIN_TOKEN, ADMIN_PORT: String(adminPort) }),
      );
      if (!result.ok) throw new Error(result.errors.join("; "));
      const { adminUrl } = result.server;
      const onAdmin = await fetch(new URL(ADVANCE, adminUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ms: 1000 }),
      });
      expect(onAdmin.status).not.toBe(200);
      expect(onAdmin.status).toBeLessThan(500);
      await running.pop()?.close();
    }
  });
});
