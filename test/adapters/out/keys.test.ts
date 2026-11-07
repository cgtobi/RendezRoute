import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  deriveKey,
  KeyError,
  openKeyring,
  parseMountPoints,
  resolveKeyLocation,
} from "../../../src/adapters/out/crypto/keyring.ts";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "rendezroute-keys-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseMountPoints", () => {
  it("reads mount points from /proc/self/mountinfo, including escaped spaces", () => {
    const mountinfo = [
      "22 1 0:21 / / ro,relatime - overlay overlay rw",
      "35 22 254:1 /volumes/keys /keys rw,relatime - ext4 /dev/vda1 rw",
      "36 22 254:1 /volumes/data /my\\040data rw,relatime - ext4 /dev/vda1 rw",
    ].join("\n");
    expect(parseMountPoints(mountinfo)).toEqual(["/", "/keys", "/my data"]);
  });
});

describe("resolveKeyLocation (spec 3.11, decision I7)", () => {
  it("uses ENCRYPTION_KEY_FILE when set", () => {
    expect(
      resolveKeyLocation({
        encryptionKeyFile: "/secrets/field.key",
        dataDir: "/data",
        mountPoints: [],
      }),
    ).toEqual({
      file: "/secrets/field.key",
      directory: "/secrets",
      warning: undefined,
    });
  });

  it("prefers a mounted /keys volume", () => {
    expect(
      resolveKeyLocation({
        encryptionKeyFile: undefined,
        dataDir: "/data",
        mountPoints: ["/", "/keys", "/data"],
      }),
    ).toEqual({
      file: "/keys/field.key",
      directory: "/keys",
      warning: undefined,
    });
  });

  it("falls back to DATA_DIR/keys with a prominent warning about backups", () => {
    const location = resolveKeyLocation({
      encryptionKeyFile: undefined,
      dataDir: "/data",
      mountPoints: ["/", "/data"],
    });
    expect(location.file).toBe("/data/keys/field.key");
    expect(location.directory).toBe("/data/keys");
    expect(location.warning).toMatch(/backups of DATA_DIR .* include the key/i);
  });
});

describe("openKeyring (spec 3.11 key handling)", () => {
  const fresh = { storedFingerprint: undefined, hasEncryptedData: false };

  it("generates a key file with owner-only permissions when none exists and no encrypted data exists", () => {
    const dir = tempDir();
    const file = join(dir, "keys", "field.key");
    const opened = openKeyring(file, fresh);

    expect(opened.created).toBe(true);
    expect(opened.keyring.current).toBe(1);
    expect(opened.keyring.keys.get(1)).toHaveLength(32);
    expect(opened.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "keys")).mode & 0o777).toBe(0o700);
  });

  it("loads the same key on the next start", () => {
    const file = join(tempDir(), "field.key");
    const first = openKeyring(file, fresh);
    const second = openKeyring(file, {
      storedFingerprint: first.fingerprint,
      hasEncryptedData: true,
    });
    expect(second.created).toBe(false);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.keyring.keys.get(1)?.equals(first.keyring.keys.get(1) ?? Buffer.alloc(0))).toBe(
      true,
    );
  });

  it("stops with a clear error when the key does not match the database", () => {
    const file = join(tempDir(), "field.key");
    openKeyring(file, fresh);
    expect(() =>
      openKeyring(file, { storedFingerprint: "0".repeat(64), hasEncryptedData: true }),
    ).toThrow(KeyError);
    expect(() =>
      openKeyring(file, { storedFingerprint: "0".repeat(64), hasEncryptedData: true }),
    ).toThrow(/does not match/);
  });

  it("stops instead of generating a new key when encrypted data exists", () => {
    const file = join(tempDir(), "field.key");
    expect(() =>
      openKeyring(file, { storedFingerprint: "a".repeat(64), hasEncryptedData: true }),
    ).toThrow(/missing/);
    expect(() => readFileSync(file)).toThrow(/ENOENT/);
  });

  it("generates a new key when the old one is gone but no encrypted data remains", () => {
    const file = join(tempDir(), "field.key");
    expect(
      openKeyring(file, { storedFingerprint: "a".repeat(64), hasEncryptedData: false }).created,
    ).toBe(true);
  });

  it("rejects malformed key files", () => {
    const file = join(tempDir(), "field.key");
    for (const content of ["", "1:short", "garbage", `x:${Buffer.alloc(32).toString("base64")}`]) {
      writeFileSync(file, content);
      expect(() => openKeyring(file, fresh)).toThrow(/malformed/);
    }
  });

  it("reads multiple versions and uses the highest as current", () => {
    const file = join(tempDir(), "field.key");
    const k1 = Buffer.alloc(32, 1).toString("base64");
    const k2 = Buffer.alloc(32, 2).toString("base64");
    writeFileSync(file, `# RendezRoute field encryption keys\n1:${k1}\n2:${k2}\n`);
    const { keyring } = openKeyring(file, fresh);
    expect(keyring.current).toBe(2);
    expect([...keyring.keys.keys()]).toEqual([1, 2]);
  });
});

describe("deriveKey", () => {
  it("derives distinct, stable 32-byte keys per purpose", () => {
    const { keyring } = openKeyring(join(tempDir(), "field.key"), {
      storedFingerprint: undefined,
      hasEncryptedData: false,
    });
    const csrf = deriveKey(keyring, "csrf");
    expect(csrf).toHaveLength(32);
    expect(deriveKey(keyring, "csrf").equals(csrf)).toBe(true);
    expect(deriveKey(keyring, "identity-hmac").equals(csrf)).toBe(false);
  });
});
