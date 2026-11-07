// AES-256-GCM field encryption (spec 3.11). Format: v<keyVersion>.<nonce>.<ciphertext+tag>,
// base64url (decision I6). The field name is authenticated as additional data (decision I16),
// so a value copied into another field fails to decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { FieldCipher } from "../../../application/ports.ts";
import { currentKey, type Keyring } from "./keyring.ts";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Keyrings are validated by createKeyring; this only uses them. */
export function createFieldCipher(keyring: Keyring): FieldCipher {
  const key = currentKey(keyring);

  return {
    encrypt(plaintext, field) {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(field, "utf8"));
      const body = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      return `v${keyring.current}.${nonce.toString("base64url")}.${body.toString("base64url")}`;
    },

    decrypt(value, field) {
      const match = /^v(\d+)\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/.exec(value);
      if (match === null) throw new Error("Malformed encrypted value.");
      const version = Number(match[1]);
      const versionKey = keyring.keys.get(version);
      if (versionKey === undefined)
        throw new Error(`Encrypted with unknown key version ${version}.`);

      const body = Buffer.from(match[3] ?? "", "base64url");
      if (body.length < TAG_BYTES) throw new Error("Malformed encrypted value.");
      const decipher = createDecipheriv(
        ALGORITHM,
        versionKey,
        Buffer.from(match[2] ?? "", "base64url"),
        {
          authTagLength: TAG_BYTES,
        },
      );
      decipher.setAAD(Buffer.from(field, "utf8"));
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
      return Buffer.concat([
        decipher.update(body.subarray(0, body.length - TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
