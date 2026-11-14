// The start step of the Home Assistant app image (decision D57). The Supervisor starts the `ha`
// image as root, creates /data and /config owned by root and rewrites /data/options.json as root
// with mode 0600 on every start. So, as root: read the options, map them, hand the directories to
// the run user; ask the Supervisor for its version (its unix socket is root-only, decision I75);
// then drop privileges, prove the drop, and serve in the same process. The privileged parts are
// ports so a test can fake them and check the order.
import { checkSupervisorVersion } from "../../../application/supervisor-version.ts";
import type { ConfigSource } from "../../../config.ts";
import type { HaDirectory } from "./directories.ts";
import { mapHomeAssistantOptions } from "./options.ts";

export type { HaDirectory };

export interface RunUser {
  uid: number;
  gid: number;
}

export interface Identity {
  uid: number;
  euid: number;
  gid: number;
  egid: number;
  groups: readonly number[];
}

export const OPTIONS_FILE = "/data/options.json";

/** Handed to the run user, parents first. The key directory is the one the key file lives in. */
export const HA_DIRECTORIES: readonly HaDirectory[] = [
  { path: "/data", mode: 0o700, recursive: true, skip: [OPTIONS_FILE] },
  { path: "/config", mode: undefined, recursive: false, skip: [] },
  { path: "/config/keys", mode: 0o700, recursive: true, skip: [] },
];

/** How the Supervisor is asked: its unix socket (no token) or TCP with the app's token. */
export type HaSupervisorEndpoint =
  | { socketPath: string; url?: undefined; token?: undefined }
  | { url: string; token: string; socketPath?: undefined };

/** The in-process fact the server is started with (decision I75); only haStart passes it. */
export interface HaServeOptions {
  ingressVersionVerified: true;
}

const DEFAULT_SUPERVISOR_URL = "http://supervisor";

/**
 * Socket first (the Supervisor sets both), else the token; the endpoint or an error text. Keep in
 * step with the SUPERVISOR_URL/SUPERVISOR_SOCKET validation in config.ts: the two can drift (config
 * also limits the socket path's length and refuses NULs).
 */
export function chooseSupervisorEndpoint(
  environment: ConfigSource,
): HaSupervisorEndpoint | { error: string } {
  const socket = environment.SUPERVISOR_SOCKET?.trim();
  if (socket !== undefined && socket !== "") {
    if (!socket.startsWith("/")) return { error: "SUPERVISOR_SOCKET must be an absolute path" };
    return { socketPath: socket };
  }
  const token = environment.SUPERVISOR_TOKEN?.trim();
  if (token === undefined || token === "") {
    return {
      error:
        "neither SUPERVISOR_SOCKET nor SUPERVISOR_TOKEN is set; the app needs hassio_api: true in its config.yaml",
    };
  }
  const given = environment.SUPERVISOR_URL?.trim();
  const text = given === undefined || given === "" ? DEFAULT_SUPERVISOR_URL : given;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: "SUPERVISOR_URL is not a URL" };
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return { error: "SUPERVISOR_URL must be an http(s) origin without credentials or path" };
  }
  return { url: url.origin, token };
}

export interface HaStartPorts {
  readOptionsFile(): Promise<string>;
  findRunUser(): Promise<RunUser | undefined>;
  /** Asks the Supervisor for its version, as root; throws when it cannot be reached or refuses. */
  supervisorVersion(endpoint: HaSupervisorEndpoint): Promise<string>;
  /** mkdir -p, chown and chmod as root (adapters/in/ha/directories.ts). */
  prepareDirectories(user: RunUser, directories: readonly HaDirectory[]): Promise<void>;
  /** Clears the supplementary groups, then setgid, then setuid. */
  dropPrivileges(user: RunUser): void;
  /** Sets the process umask to 0077 so nothing the server creates is readable by others. */
  restrictUmask(): void;
  identity(): Identity;
  /** Tries to become root again; true means the drop is worthless. */
  canRegainRoot(): boolean;
  serve(env: ConfigSource, options: HaServeOptions): Promise<void>;
  /** The real process environment, read as root: only the Supervisor's variables are used. */
  environment: ConfigSource;
}

export type HaStartResult = { ok: true } | { ok: false; message: string };

const fail = (message: string): HaStartResult => ({ ok: false, message });

/** The messages never carry the options file's content: it holds secrets. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/** uid and gid of `name` from /etc/passwd text; never root, never a malformed line. */
export function parsePasswd(passwd: string, name: string): RunUser | undefined {
  for (const line of passwd.split("\n")) {
    const [user, , uid, gid] = line.split(":");
    if (user !== name || uid === undefined || gid === undefined) continue;
    if (!/^\d+$/.test(uid) || !/^\d+$/.test(gid) || Number(uid) === 0) return undefined;
    return { uid: Number(uid), gid: Number(gid) };
  }
  return undefined;
}

export async function haStart(ports: HaStartPorts): Promise<HaStartResult> {
  let text: string;
  try {
    text = await ports.readOptionsFile();
  } catch (error) {
    return fail(`cannot read ${OPTIONS_FILE}: ${reason(error)}`);
  }
  let options: unknown;
  try {
    options = JSON.parse(text);
  } catch {
    // The parser's message quotes the text.
    return fail(`${OPTIONS_FILE} is not valid JSON`);
  }
  const mapped = mapHomeAssistantOptions(options);
  if (!mapped.ok) {
    return fail(`invalid app options\n${mapped.errors.map((error) => `  - ${error}`).join("\n")}`);
  }

  const user = await ports.findRunUser();
  if (user === undefined) return fail("the user the app runs as does not exist in this image");
  try {
    await ports.prepareDirectories(user, HA_DIRECTORIES);
  } catch (error) {
    return fail(`cannot prepare the data and config folders: ${reason(error)}`);
  }

  // As root, before the drop: the socket is root-only and the token must not reach the server.
  // A failure here ends the start with the server never started (the drop is irrelevant then).
  const endpoint = chooseSupervisorEndpoint(ports.environment);
  if ("error" in endpoint) return fail(`cannot ask the Supervisor: ${endpoint.error}`);
  const checked = await checkSupervisorVersion(
    {
      version: () =>
        ports.supervisorVersion(endpoint).catch((error: unknown) => {
          const text = reason(error);
          throw new Error(
            text.includes("HTTP 403") ? `${text}; the app needs hassio_api: true` : text,
          );
        }),
    },
    { remedy: "The app asks the Supervisor once at start; it must be running and reachable." },
  );
  if (!checked.ok) return fail(checked.message);

  try {
    ports.dropPrivileges(user);
  } catch (error) {
    return fail(`cannot drop privileges: ${reason(error)}`);
  }
  const now = ports.identity();
  const dropped =
    now.uid === user.uid &&
    now.euid === user.uid &&
    now.gid === user.gid &&
    now.egid === user.gid &&
    now.groups.every((group) => group === user.gid);
  if (!dropped || ports.canRegainRoot()) {
    return fail("privileges were not dropped completely, refusing to start");
  }

  ports.restrictUmask();
  // The server gets the mapped options only: no Supervisor token, no socket path.
  try {
    await ports.serve({ ...mapped.env }, { ingressVersionVerified: true });
  } catch (error) {
    return fail(reason(error));
  }
  return { ok: true };
}
