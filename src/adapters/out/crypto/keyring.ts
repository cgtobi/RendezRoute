// Field-encryption key handling (spec 3.11 "Key handling", decision I7).
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export interface Keyring {
  /** Version used for new encryptions. */
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

/** Startup-blocking key problem; the message tells the operator what to do. */
export class KeyError extends Error {
  override name = "KeyError";
}

/** Purposes for derived keys; each gets an independent key via HKDF. */
export type KeyPurpose = "csrf" | "identity-lookup";

const KEY_BYTES = 32;
const KEYS_VOLUME = "/keys";
const KEY_FILE_NAME = "field.key";

/** The only way to build a Keyring: every key is 32 bytes and the current version exists. */
export function createKeyring(current: number, entries: Iterable<[number, Buffer]>): Keyring {
  const keys = new Map(entries);
  for (const [version, key] of keys) {
    if (key.length !== KEY_BYTES) {
      throw new KeyError(`Encryption key version ${version} must be ${KEY_BYTES} bytes.`);
    }
  }
  if (!keys.has(current))
    throw new KeyError(`The keyring has no current key (version ${current}).`);
  return { current, keys };
}

export function currentKey(keyring: Keyring): Buffer {
  const key = keyring.keys.get(keyring.current);
  if (key === undefined)
    throw new KeyError(`The keyring has no current key (version ${keyring.current}).`);
  return key;
}

/** Mount points from /proc/self/mountinfo (field 5; octal escapes such as \040 decoded). */
export function parseMountPoints(mountinfo: string): string[] {
  return mountinfo
    .split("\n")
    .map((line) => line.split(" ")[4])
    .filter((field): field is string => field !== undefined && field !== "")
    .map((field) =>
      field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))),
    );
}

export interface KeyLocation {
  file: string;
  directory: string;
  /** Set when the key lives inside DATA_DIR, whose backups then include it. */
  warning: string | undefined;
}

function isInside(file: string, directory: string): boolean {
  const path = relative(directory, file);
  return path !== "" && !path.startsWith("..") && !path.startsWith("/");
}

function backupWarning(directory: string): string {
  return (
    `The encryption key is stored in ${directory}, inside DATA_DIR. ` +
    "Backups of DATA_DIR then include the key, which defeats encryption at rest for those backups. " +
    `Mount a separate volume at ${KEYS_VOLUME} or point ENCRYPTION_KEY_FILE outside DATA_DIR (spec 3.11).`
  );
}

export function resolveKeyLocation(options: {
  encryptionKeyFile: string | undefined;
  dataDir: string;
  mountPoints: readonly string[];
}): KeyLocation {
  if (options.encryptionKeyFile !== undefined) {
    const directory = dirname(options.encryptionKeyFile);
    return {
      file: options.encryptionKeyFile,
      directory,
      warning: isInside(options.encryptionKeyFile, options.dataDir)
        ? backupWarning(directory)
        : undefined,
    };
  }
  if (options.mountPoints.includes(KEYS_VOLUME)) {
    return { file: join(KEYS_VOLUME, KEY_FILE_NAME), directory: KEYS_VOLUME, warning: undefined };
  }
  const directory = join(options.dataDir, "keys");
  return { file: join(directory, KEY_FILE_NAME), directory, warning: backupWarning(directory) };
}

export function keyFingerprint(key: Buffer): string {
  return createHmac("sha256", key).update("rendezroute/key-fingerprint/v1").digest("hex");
}

/** Purpose-specific key derived from the current key with HKDF. */
export function deriveKey(keyring: Keyring, purpose: KeyPurpose): Buffer {
  return Buffer.from(
    hkdfSync("sha256", currentKey(keyring), "rendezroute", `rendezroute/${purpose}`, KEY_BYTES),
  );
}

function parseKeyring(file: string, content: string): Keyring {
  const entries: [number, Buffer][] = [];
  const malformed = (detail: string) =>
    new KeyError(`The key file ${file} is malformed: ${detail}. Restore it from your key backup.`);

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(\d+):([A-Za-z0-9+/]+={0,2})$/.exec(line);
    if (match === null) throw malformed("expected lines of the form <version>:<base64 key>");
    const version = Number(match[1]);
    if (version < 1 || entries.some(([existing]) => existing === version)) {
      throw malformed(`invalid or duplicate version ${version}`);
    }
    entries.push([version, Buffer.from(match[2] ?? "", "base64")]);
  }
  if (entries.length === 0) throw malformed("it contains no keys");

  try {
    return createKeyring(Math.max(...entries.map(([version]) => version)), entries);
  } catch (error) {
    throw malformed((error as Error).message.replace(/\.$/, ""));
  }
}

export interface OpenedKeyring {
  keyring: Keyring;
  fingerprint: string;
  created: boolean;
}

/**
 * Loads the keyring, or generates one only when none exists and the database holds
 * no encrypted data. A missing, mismatching or unverifiable key with existing data stops the app.
 */
export function openKeyring(
  file: string,
  database: { storedFingerprint: string | undefined; hasEncryptedData: boolean },
): OpenedKeyring {
  if (existsSync(file)) {
    const keyring = parseKeyring(file, readFileSync(file, "utf8"));
    const fingerprint = keyFingerprint(currentKey(keyring));
    if (database.storedFingerprint === undefined && database.hasEncryptedData) {
      throw new KeyError(
        `The database contains encrypted data but no key fingerprint, so the key in ${file} cannot be verified. ` +
          "Restore the database's instance_meta table from a backup.",
      );
    }
    if (database.storedFingerprint !== undefined && database.storedFingerprint !== fingerprint) {
      throw new KeyError(
        `The encryption key in ${file} does not match the key this database was encrypted with. ` +
          "Mount the correct key file; starting with a different key would make existing data unreadable.",
      );
    }
    return { keyring, fingerprint, created: false };
  }

  if (database.hasEncryptedData) {
    throw new KeyError(
      `The encryption key file ${file} is missing, but the database contains encrypted data. ` +
        "Mount or restore the key file; without it the encrypted data is unrecoverable.",
    );
  }

  const key = randomBytes(KEY_BYTES);
  const directory = dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  writeFileSync(
    file,
    `# RendezRoute field encryption keys. Back this file up separately from DATA_DIR.\n1:${key.toString("base64")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  chmodSync(file, 0o600);
  return { keyring: createKeyring(1, [[1, key]]), fingerprint: keyFingerprint(key), created: true };
}
