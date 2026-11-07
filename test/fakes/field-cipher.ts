import type { EncryptedField, FieldCipher } from "../../src/application/ports.ts";

/**
 * Reversible stand-in for use-case tests. Not encryption: privacy and
 * encryption-at-rest tests must use the real cipher.
 */
export class FakeFieldCipher implements FieldCipher {
  encrypt(plaintext: string, field: EncryptedField): string {
    return `fake:${field}:${Buffer.from(plaintext, "utf8").toString("base64url")}`;
  }

  decrypt(ciphertext: string, field: EncryptedField): string {
    const prefix = `fake:${field}:`;
    if (!ciphertext.startsWith(prefix))
      throw new Error("FakeFieldCipher: value belongs to a different field");
    return Buffer.from(ciphertext.slice(prefix.length), "base64url").toString("utf8");
  }
}
