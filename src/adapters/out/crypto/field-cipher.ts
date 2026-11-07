// AES-256-GCM field encryption (spec 3.11). Format: v<keyVersion>.<nonce>.<ciphertext+tag>,
// base64url (decision I6). The context (field name) is authenticated as additional data,
// so a value copied into another field fails to decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { FieldCipher } from "../../../application/ports.ts";
import type { Keyring } from "./keyring.ts";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function createFieldCipher(keyring: Keyring): FieldCipher {
  for (const [version, key] of keyring.keys) {
    if (key.length !== 32) throw new Error(`Encryption key version ${version} must be 32 bytes.`);
  }
  const current = keyring.keys.get(keyring.current);
  if (current === undefined)
    throw new Error(`The keyring has no current key (version ${keyring.current}).`);

  return {
    encrypt(plaintext, context) {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, current, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(context, "utf8"));
      const body = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      return `v${keyring.current}.${nonce.toString("base64url")}.${body.toString("base64url")}`;
    },

    decrypt(value, context) {
      const match = /^v(\d+)\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/.exec(value);
      if (match === null) throw new Error("Malformed encrypted value.");
      const version = Number(match[1]);
      const key = keyring.keys.get(version);
      if (key === undefined) throw new Error(`Encrypted with unknown key version ${version}.`);

      const body = Buffer.from(match[3] ?? "", "base64url");
      if (body.length < TAG_BYTES) throw new Error("Malformed encrypted value.");
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(match[2] ?? "", "base64url"), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
      return Buffer.concat([
        decipher.update(body.subarray(0, body.length - TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
