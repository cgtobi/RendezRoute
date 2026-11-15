#!/usr/bin/env node
// Entry point of the `ha` image (decision D57), like cli.ts: the real privileged ports around the
// start step in adapters/in/ha/start.ts. Runs as root: asks the Supervisor (decision I75) and drops
// privileges; the server then runs as the image's `node` user.
import { readFile } from "node:fs/promises";
import { prepareDirectories } from "./adapters/in/ha/directories.ts";
import { haStart, parsePasswd, OPTIONS_FILE } from "./adapters/in/ha/start.ts";
import { createSupervisorInfo } from "./adapters/out/supervisor/supervisor-info.ts";
import { runServe } from "./main.ts";

const RUN_USER = "node";

const result = await haStart({
  readOptionsFile: () => readFile(OPTIONS_FILE, "utf8"),
  async findRunUser() {
    return parsePasswd(await readFile("/etc/passwd", "utf8"), RUN_USER);
  },
  prepareDirectories: (user, directories) => prepareDirectories(user, directories),
  supervisorVersion: (endpoint) =>
    createSupervisorInfo(
      endpoint.socketPath !== undefined
        ? { socketPath: endpoint.socketPath }
        : { url: new URL(endpoint.url), token: endpoint.token },
    ).version(),
  notify: (message) => console.error(`RendezRoute: ${message}`),
  dropPrivileges(user) {
    // Supplementary groups first (root's), then the group, and the user last: after setuid the
    // process may no longer change either.
    if (
      process.setgroups === undefined ||
      process.setgid === undefined ||
      process.setuid === undefined
    ) {
      throw new Error("this platform cannot change the user");
    }
    process.setgroups([]);
    process.setgid(user.gid);
    process.setuid(user.uid);
  },
  restrictUmask() {
    process.umask(0o077);
  },
  identity: () => ({
    uid: process.getuid?.() ?? -1,
    euid: process.geteuid?.() ?? -1,
    gid: process.getgid?.() ?? -1,
    egid: process.getegid?.() ?? -1,
    groups: process.getgroups?.() ?? [-1],
  }),
  canRegainRoot() {
    // A platform that cannot be asked counts as not dropped.
    if (process.setuid === undefined) return true;
    try {
      process.setuid(0);
    } catch {
      return false;
    }
    return true;
  },
  serve(env, options) {
    // The server reads its configuration from `env`; keep the Supervisor's variables out of the
    // process environment too (children inherit it).
    for (const name of [
      "SUPERVISOR_TOKEN",
      "SUPERVISOR_SOCKET",
      "SUPERVISOR_URL",
      "HASSIO_TOKEN",
    ]) {
      delete process.env[name];
    }
    return runServe(env, options);
  },
  environment: process.env,
});

if (!result.ok) {
  console.error(`RendezRoute cannot start: ${result.message}`);
  process.exit(1);
}
