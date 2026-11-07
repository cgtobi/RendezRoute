import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../src/adapters/out/crypto/field-cipher.ts";
import type { Keyring } from "../../../src/adapters/out/crypto/keyring.ts";

const key1 = randomBytes(32);
const key2 = randomBytes(32);
const keyring = (current: number, entries: [number, Buffer][]): Keyring => ({
  current,
  keys: new Map(entries),
});
const SENTINEL = "SENTINEL-display-name-7f3a";

describe("FieldCipher (spec 3.11, decision I6)", () => {
  const cipher = createFieldCipher(keyring(1, [[1, key1]]));

  it("round-trips and produces the versioned format v<n>.<nonce>.<ciphertext+tag>", () => {
    const encrypted = cipher.encrypt(SENTINEL, "responses.display_name");
    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain(SENTINEL);
    expect(cipher.decrypt(encrypted, "responses.display_name")).toBe(SENTINEL);
  });

  it("uses a fresh nonce for every encryption", () => {
    expect(cipher.encrypt("same", "ctx")).not.toBe(cipher.encrypt("same", "ctx"));
  });

  it("handles empty strings and non-ASCII text", () => {
    for (const text of ["", "Übung am Fluss 🏃‍♀️"]) {
      expect(cipher.decrypt(cipher.encrypt(text, "ctx"), "ctx")).toBe(text);
    }
  });

  it("rejects tampered ciphertext", () => {
    const [version, nonce, body] = cipher.encrypt("secret", "ctx").split(".") as [
      string,
      string,
      string,
    ];
    const bytes = Buffer.from(body, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(() =>
      cipher.decrypt(`${version}.${nonce}.${bytes.toString("base64url")}`, "ctx"),
    ).toThrow(/unable to authenticate/);
  });

  it("rejects a value moved to a different field (context mismatch)", () => {
    const encrypted = cipher.encrypt("secret", "responses.request_note");
    expect(() => cipher.decrypt(encrypted, "responses.display_name")).toThrow(
      /unable to authenticate/,
    );
  });

  it("rejects unknown key versions and malformed values", () => {
    const encrypted = cipher.encrypt("secret", "ctx");
    expect(() => cipher.decrypt(encrypted.replace(/^v1\./, "v9."), "ctx")).toThrow(/key version 9/);
    for (const bad of ["", "v1", "v1.abc", "x1.a.b", "v1.a.b.c"]) {
      expect(() => cipher.decrypt(bad, "ctx")).toThrow(/Malformed/);
    }
  });

  it("encrypts with the current key and still decrypts older versions after rotation", () => {
    const old = cipher.encrypt("before rotation", "ctx");
    const rotated = createFieldCipher(
      keyring(2, [
        [1, key1],
        [2, key2],
      ]),
    );
    expect(rotated.encrypt("after", "ctx")).toMatch(/^v2\./);
    expect(rotated.decrypt(old, "ctx")).toBe("before rotation");
  });

  it("requires 32-byte keys and a current key", () => {
    expect(() => createFieldCipher(keyring(1, [[1, randomBytes(16)]]))).toThrow(/32 bytes/);
    expect(() => createFieldCipher(keyring(2, [[1, key1]]))).toThrow(/current key/);
  });
});
