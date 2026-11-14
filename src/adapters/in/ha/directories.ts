// Handing the app's directories to the run user, as root (decision D57). The app owns /config and
// /data and could replace a directory there with a link; the next root start must not follow it.
// So each top-level directory is opened without following links and changed through the open
// handle, and the walk below it uses lstat/lchown and never descends into a link.
import { constants } from "node:fs";
import { lchown, lstat, mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface HaDirectory {
  path: string;
  /** Set explicitly when the directory must be private; undefined leaves the mode alone. */
  mode: number | undefined;
  /** Whether everything below it is handed over too (never through symbolic links). */
  recursive: boolean;
  /** Paths below it that stay as they are: the Supervisor's options file stays root's. */
  skip: readonly string[];
}

export interface Owner {
  uid: number;
  gid: number;
}

type ChownLink = (path: string, uid: number, gid: number) => Promise<void>;

/** Hands everything below `path` over, never following a link. */
async function walk(
  path: string,
  owner: Owner,
  skip: readonly string[],
  chownLink: ChownLink,
): Promise<void> {
  for (const name of await readdir(path)) {
    const child = join(path, name);
    if (skip.includes(child)) continue;
    const stats = await lstat(child);
    await chownLink(child, owner.uid, owner.gid);
    if (stats.isDirectory()) await walk(child, owner, skip, chownLink);
  }
}

const NOT_A_DIRECTORY = new Set(["ELOOP", "ENOTDIR", "EEXIST"]);

/** mkdir -p, then chown and chmod each directory through a handle opened without following links. */
export async function prepareDirectories(
  owner: Owner,
  directories: readonly HaDirectory[],
  chownLink: ChownLink = lchown,
): Promise<void> {
  for (const directory of directories) {
    const notADirectory = new Error(`${directory.path} is not a directory`);
    try {
      await mkdir(directory.path, { recursive: true });
    } catch (error) {
      if (NOT_A_DIRECTORY.has((error as { code?: string }).code ?? "")) throw notADirectory;
      throw error;
    }
    const handle = await open(
      directory.path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    ).catch((error: unknown) => {
      if (NOT_A_DIRECTORY.has((error as { code?: string }).code ?? "")) throw notADirectory;
      throw error;
    });
    try {
      await handle.chown(owner.uid, owner.gid);
      if (directory.mode !== undefined) await handle.chmod(directory.mode);
    } finally {
      await handle.close();
    }
    if (directory.recursive) await walk(directory.path, owner, directory.skip, chownLink);
  }
}
