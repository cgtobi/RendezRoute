// Preparing the data and key directories as root (decision D57), run in a temp dir with the
// current user's own ids (chown to yourself needs no root). The app owns /config, so a link
// planted there must never be followed by the next root start.
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type HaDirectory,
  prepareDirectories,
} from "../../../../src/adapters/in/ha/directories.ts";

const user = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rr-dirs-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const modeOf = async (path: string) => (await lstat(path)).mode & 0o7777;

function layout(): { data: HaDirectory; config: HaDirectory; keys: HaDirectory } {
  const options = join(root, "data", "options.json");
  return {
    data: { path: join(root, "data"), mode: 0o700, recursive: true, skip: [options] },
    config: { path: join(root, "config"), mode: undefined, recursive: false, skip: [] },
    keys: { path: join(root, "config", "keys"), mode: 0o700, recursive: true, skip: [] },
  };
}

describe("preparing the directories", () => {
  it("creates them and makes data and keys private, files keep their modes", async () => {
    const { data, config, keys } = layout();
    await mkdir(data.path, { mode: 0o755 });
    await writeFile(join(data.path, "app.db"), "x", { mode: 0o640 });
    await mkdir(join(data.path, "backups"), { mode: 0o755 });
    await writeFile(join(data.path, "backups", "b.db"), "x", { mode: 0o644 });
    await prepareDirectories(user, [data, config, keys]);
    expect(await modeOf(data.path)).toBe(0o700);
    expect(await modeOf(keys.path)).toBe(0o700);
    expect((await lstat(keys.path)).isDirectory()).toBe(true);
    expect(await modeOf(join(data.path, "app.db"))).toBe(0o640);
    expect(await modeOf(join(data.path, "backups"))).toBe(0o755);
    expect(await modeOf(join(data.path, "backups", "b.db"))).toBe(0o644);
  });

  it("honours the skip entry", async () => {
    const { data } = layout();
    await mkdir(data.path);
    const options = join(data.path, "options.json");
    await writeFile(options, "{}", { mode: 0o600 });
    await writeFile(join(data.path, "app.db"), "x");
    const handed: string[] = [];
    await prepareDirectories(user, [data], async (path) => {
      handed.push(path);
    });
    expect(handed).toEqual([join(data.path, "app.db")]);
  });

  it("does not follow a directory link planted inside the tree", async () => {
    const { keys, config } = layout();
    const outside = join(root, "outside");
    await mkdir(outside, { mode: 0o755 });
    await writeFile(join(outside, "secret"), "x", { mode: 0o644 });
    await mkdir(keys.path, { recursive: true });
    await symlink(outside, join(keys.path, "link"));
    const before = await lstat(outside);
    await prepareDirectories(user, [config, keys]);
    const after = await lstat(outside);
    expect(after.mode).toBe(before.mode);
    expect(after.uid).toBe(before.uid);
    expect(await modeOf(join(outside, "secret"))).toBe(0o644);
    expect((await lstat(join(keys.path, "link"))).isSymbolicLink()).toBe(true);
  });

  it("refuses a top-level directory that is a link, leaving its target alone", async () => {
    const { config, keys } = layout();
    const target = join(root, "etc");
    await mkdir(target, { mode: 0o755 });
    await mkdir(config.path);
    await symlink(target, keys.path);
    await expect(prepareDirectories(user, [config, keys])).rejects.toThrow(
      `${keys.path} is not a directory`,
    );
    expect(await modeOf(target)).toBe(0o755);
  });

  it("refuses a link as /config itself, before touching anything below it", async () => {
    const { config, keys } = layout();
    const target = join(root, "etc");
    await mkdir(join(target, "keys"), { recursive: true, mode: 0o755 });
    await symlink(target, config.path);
    await expect(prepareDirectories(user, [config, keys])).rejects.toThrow(
      `${config.path} is not a directory`,
    );
    expect(await modeOf(join(target, "keys"))).toBe(0o755);
  });

  it("refuses a regular file at the directory path", async () => {
    const { config, keys } = layout();
    await mkdir(config.path);
    await writeFile(keys.path, "x");
    await chmod(keys.path, 0o644);
    await expect(prepareDirectories(user, [config, keys])).rejects.toThrow(
      `${keys.path} is not a directory`,
    );
    expect(await modeOf(keys.path)).toBe(0o644);
  });
});
