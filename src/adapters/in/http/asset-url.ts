// Versioned asset URLs (decision D82): `static/app.css?v=<hash>`, so a changed file gets a new URL
// at once and old HTML never meets new CSS. The hash is the first 10 hex characters of the SHA-256
// of the file's bytes, computed when the file is first linked and re-read when its modification
// time changes (the dev server picks up edits). A missing file (unit tests, before a build) gives
// the plain URL.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Bundled assets, relative to the working directory as serveStatic expects (same from src/ and dist/). */
export const STATIC_ROOT = relative(
  process.cwd(),
  fileURLToPath(new URL("../../../../public", import.meta.url)),
);

const HASH_LENGTH = 10;
const cache = new Map<string, { mtimeMs: number; hash: string }>();

/** The first 10 hex characters of the SHA-256 of the bytes. */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, HASH_LENGTH);
}

/** The hash of a file under the static root, or undefined when it cannot be read. */
function fileHash(file: string): string | undefined {
  try {
    const { mtimeMs } = statSync(file);
    const cached = cache.get(file);
    if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.hash;
    const hash = contentHash(readFileSync(file));
    cache.set(file, { mtimeMs, hash });
    return hash;
  } catch {
    cache.delete(file);
    return undefined;
  }
}

/** The file for a path below the root; undefined when it would leave the root. */
function insideRoot(root: string, path: string): string | undefined {
  const file = resolve(root, path);
  const from = relative(resolve(root), file);
  return from === "" || from.startsWith("..") || isAbsolute(from) ? undefined : join(root, path);
}

/**
 * The URL of a bundled file ("app.css", "build/map.js") below the path prefix, with `?v=<hash>`
 * when the file exists. `path` must be a trusted constant, never request input. `root` is for tests.
 */
export function assetUrl(pathBase: string, path: string, root: string = STATIC_ROOT): string {
  const url = `${pathBase}static/${path}`;
  const file = insideRoot(root, path);
  const hash = file === undefined ? undefined : fileHash(file);
  return hash === undefined ? url : `${url}?v=${hash}`;
}

/**
 * The current hash of a file below the root, for a path taken from a request; undefined when the
 * file is missing or the path leaves the root.
 */
export function currentVersion(path: string, root: string = STATIC_ROOT): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  const file = insideRoot(root, decoded);
  return file === undefined ? undefined : fileHash(file);
}
