import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { createFieldCipher } from "../../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../../src/adapters/out/crypto/keyring.ts";

const key1 = randomBytes(32);
const key2 = randomBytes(32);

const SENTINEL = "SENTINEL-display-name-7f3a";

describe("FieldCipher (spec 3.11, decision I6)", () => {
  const cipher = createFieldCipher(createKeyring(1, [[1, key1]]));

  it("round-trips and produces the versioned format v<n>.<nonce>.<ciphertext+tag>", () => {
    const encrypted = cipher.encrypt(SENTINEL, "responses.display_name");
    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain(SENTINEL);
    expect(cipher.decrypt(encrypted, "responses.display_name")).toBe(SENTINEL);
  });

  it("uses a fresh nonce for every encryption", () => {
    expect(cipher.encrypt("same", "plans.exact_location")).not.toBe(
      cipher.encrypt("same", "plans.exact_location"),
    );
  });

  it("handles empty strings and non-ASCII text", () => {
    for (const text of ["", "Übung am Fluss 🏃‍♀️"]) {
      expect(
        cipher.decrypt(cipher.encrypt(text, "plans.exact_location"), "plans.exact_location"),
      ).toBe(text);
    }
  });

  it("rejects tampered ciphertext", () => {
    const [version, nonce, body] = cipher.encrypt("secret", "plans.exact_location").split(".") as [
      string,
      string,
      string,
    ];
    const bytes = Buffer.from(body, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(() =>
      cipher.decrypt(`${version}.${nonce}.${bytes.toString("base64url")}`, "plans.exact_location"),
    ).toThrow(/unable to authenticate/);
  });

  it("rejects a value moved to a different field (context mismatch)", () => {
    const encrypted = cipher.encrypt("secret", "responses.request_note");
    expect(() => cipher.decrypt(encrypted, "responses.display_name")).toThrow(
      /unable to authenticate/,
    );
  });

  it("rejects unknown key versions and malformed values", () => {
    const encrypted = cipher.encrypt("secret", "plans.exact_location");
    expect(() => cipher.decrypt(encrypted.replace(/^v1\./, "v9."), "plans.exact_location")).toThrow(
      /key version 9/,
    );
    for (const bad of ["", "v1", "v1.abc", "x1.a.b", "v1.a.b.c"]) {
      expect(() => cipher.decrypt(bad, "plans.exact_location")).toThrow(/Malformed/);
    }
  });

  it("encrypts with the current key and still decrypts older versions after rotation", () => {
    const old = cipher.encrypt("before rotation", "plans.exact_location");
    const rotated = createFieldCipher(
      createKeyring(2, [
        [1, key1],
        [2, key2],
      ]),
    );
    expect(rotated.encrypt("after", "plans.exact_location")).toMatch(/^v2\./);
    expect(rotated.decrypt(old, "plans.exact_location")).toBe("before rotation");
  });
});
