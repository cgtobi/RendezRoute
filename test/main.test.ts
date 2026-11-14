import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, createConnection } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import BetterSqlite3 from "better-sqlite3";
import { runApplyRetentionMax, runBackup, type RunningServer, startServer } from "../src/main.ts";

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
