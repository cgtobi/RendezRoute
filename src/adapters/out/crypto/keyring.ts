// Field-encryption key handling (spec 3.11 "Key handling", decision I7).
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Keyring {
  /** Version used for new encryptions. */
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

export class KeyError extends Error {
  constructor(
    readonly reason: "missing" | "mismatch" | "malformed",
    message: string,
  ) {
    super(message);
    this.name = "KeyError";
  }
}

const KEY_BYTES = 32;
const KEYS_VOLUME = "/keys";
const KEY_FILE_NAME = "field.key";

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
  /** Set when falling back to DATA_DIR, whose backups then include the key. */
  warning: string | undefined;
}

export function resolveKeyLocation(options: {
  encryptionKeyFile: string | undefined;
  dataDir: string;
  mountPoints: readonly string[];
}): KeyLocation {
  if (options.encryptionKeyFile !== undefined) {
    return {
      file: options.encryptionKeyFile,
      directory: dirname(options.encryptionKeyFile),
      warning: undefined,
    };
  }
  if (options.mountPoints.includes(KEYS_VOLUME)) {
    return { file: join(KEYS_VOLUME, KEY_FILE_NAME), directory: KEYS_VOLUME, warning: undefined };
  }
  const directory = join(options.dataDir, "keys");
  return {
    file: join(directory, KEY_FILE_NAME),
    directory,
    warning:
      `${KEYS_VOLUME} is not a mounted volume, so keys are stored in ${directory}. ` +
      "Backups of DATA_DIR then include the key, which defeats encryption at rest for those backups. " +
      `Mount a separate volume at ${KEYS_VOLUME} (spec 3.11).`,
  };
}

export function keyFingerprint(key: Buffer): string {
  return createHmac("sha256", key).update("rendezroute/key-fingerprint/v1").digest("hex");
}

/** Purpose-specific key (e.g. CSRF signing) derived from the current key with HKDF. */
export function deriveKey(keyring: Keyring, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", currentKey(keyring), "rendezroute", `rendezroute/${purpose}`, KEY_BYTES),
  );
}

export function currentKey(keyring: Keyring): Buffer {
  const key = keyring.keys.get(keyring.current);
  if (key === undefined)
    throw new KeyError("malformed", `No current key (version ${keyring.current}) in the keyring.`);
  return key;
}

function parseKeyring(file: string, content: string): Keyring {
  const keys = new Map<number, Buffer>();
  const malformed = (detail: string) =>
    new KeyError(
      "malformed",
      `The key file ${file} is malformed: ${detail}. Restore it from your key backup.`,
    );

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(\d+):([A-Za-z0-9+/]+={0,2})$/.exec(line);
    if (match === null) throw malformed("expected lines of the form <version>:<base64 key>");
    const version = Number(match[1]);
    const key = Buffer.from(match[2] ?? "", "base64");
    if (version < 1 || keys.has(version))
      throw malformed(`invalid or duplicate version ${version}`);
    if (key.length !== KEY_BYTES)
      throw malformed(`key version ${version} is not ${KEY_BYTES} bytes`);
    keys.set(version, key);
  }
  if (keys.size === 0) throw malformed("it contains no keys");
  return { current: Math.max(...keys.keys()), keys };
}

export interface OpenedKeyring {
  keyring: Keyring;
  fingerprint: string;
  created: boolean;
}

/**
 * Loads the keyring, or generates one only when none exists and the database holds
 * no encrypted data. A missing or mismatching key with existing data stops the app.
 */
export function openKeyring(
  file: string,
  database: { storedFingerprint: string | undefined; hasEncryptedData: boolean },
): OpenedKeyring {
  if (existsSync(file)) {
    const keyring = parseKeyring(file, readFileSync(file, "utf8"));
    const fingerprint = keyFingerprint(currentKey(keyring));
    if (database.storedFingerprint !== undefined && database.storedFingerprint !== fingerprint) {
      throw new KeyError(
        "mismatch",
        `The encryption key in ${file} does not match the key this database was encrypted with. ` +
          "Mount the correct key file; starting with a different key would make existing data unreadable.",
      );
    }
    return { keyring, fingerprint, created: false };
  }

  if (database.hasEncryptedData) {
    throw new KeyError(
      "missing",
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
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  chmodSync(file, 0o600);
  const keyring: Keyring = { current: 1, keys: new Map([[1, key]]) };
  return { keyring, fingerprint: keyFingerprint(key), created: true };
}
