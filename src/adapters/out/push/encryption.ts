// Message encryption for Web Push (RFC 8291, "aes128gcm" content coding, RFC 8188): only the
// subscribed browser can read a message; the push service sees ciphertext.
import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

const RECORD_SIZE = 4096;
const enc = (text: string) => Buffer.from(text, "utf8");

/** For tests: the RFC's fixed sender key and salt. Normally both are fresh per message. */
export interface EncryptionInputs {
  senderPrivateKey?: Uint8Array;
  salt?: Uint8Array;
}

export function encryptPayload(
  plaintext: Uint8Array,
  subscription: { p256dh: string; auth: string },
  inputs: EncryptionInputs = {},
): Uint8Array {
  const uaPublic = Buffer.from(subscription.p256dh, "base64url");
  const authSecret = Buffer.from(subscription.auth, "base64url");
  const sender = createECDH("prime256v1");
  if (inputs.senderPrivateKey === undefined) sender.generateKeys();
  else sender.setPrivateKey(Buffer.from(inputs.senderPrivateKey));
  const asPublic = sender.getPublicKey();
  const salt = Buffer.from(inputs.salt ?? randomBytes(16));

  // RFC 8291 section 3.4: combine the ECDH secret with the authentication secret.
  const ecdhSecret = sender.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([enc("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  // RFC 8188 section 2.2: content encryption key and nonce.
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, enc("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, enc("Content-Encoding: nonce\0"), 12));

  // One record, marked as the last by the 0x02 delimiter.
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, record]);
}
