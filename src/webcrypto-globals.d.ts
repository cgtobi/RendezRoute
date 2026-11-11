// The WebCrypto type names browsers declare globally. Fedify's signing API uses them (spec 2:
// federation); on the server they are Node's own WebCrypto types, so nothing else is added.
import type { webcrypto } from "node:crypto";

declare global {
  type CryptoKeyPair = webcrypto.CryptoKeyPair;
  type JsonWebKey = webcrypto.JsonWebKey;
}
