// Keyed lookup hashes (spec 3.11): HMAC-SHA-256 with a key derived from the encryption key, so an
// encrypted value (an account's subject) can be found without storing it in the clear.
import { createHmac } from "node:crypto";
import type { LookupHasher } from "../../../application/ports.ts";

export function createLookupHasher(key: Buffer): LookupHasher {
  return { hash: (value) => createHmac("sha256", key).update(value, "utf8").digest("hex") };
}
