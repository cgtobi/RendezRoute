// The instance actor's signing keys (spec 3.11, 10; decision D36): RSA for Mastodon's HTTP
// signatures and Ed25519 for newer servers, generated on first start and kept in the key directory
// next to the encryption and VAPID keys. Replacing them would make other servers distrust the
// instance actor, so a damaged file stops the app instead of being overwritten.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportJwk, generateCryptoKeyPair, importJwk } from "@fedify/fedify";

const FILE = "federation-instance.json";
const ALGORITHMS = ["RSASSA-PKCS1-v1_5", "Ed25519"] as const;

/** A signing key pair, as Fedify's actor key dispatcher takes it. */
export type SigningKeyPair = Awaited<ReturnType<typeof generateCryptoKeyPair>>;
type Jwk = Awaited<ReturnType<typeof exportJwk>>;

interface StoredPair {
  privateKey: Jwk;
  publicKey: Jwk;
}

export async function loadOrCreateInstanceKeys(directory: string): Promise<SigningKeyPair[]> {
  const path = join(directory, FILE);
  if (existsSync(path)) {
    try {
      const stored = JSON.parse(readFileSync(path, "utf8")) as StoredPair[];
      if (Array.isArray(stored) && stored.length === ALGORITHMS.length) {
        const pairs = await Promise.all(
          stored.map(async (pair) => ({
            privateKey: await importJwk(pair.privateKey, "private"),
            publicKey: await importJwk(pair.publicKey, "public"),
          })),
        );
        // RSA first: Mastodon's signatures use the first key (federation.ts publicKey).
        if (pairs.every((pair, index) => pair.privateKey.algorithm.name === ALGORITHMS[index])) {
          return pairs;
        }
      }
    } catch {
      // Reported below.
    }
    throw new Error(`The federation key file ${path} is damaged. Restore it from a backup.`);
  }
  const pairs = await Promise.all(ALGORITHMS.map((algorithm) => generateCryptoKeyPair(algorithm)));
  const stored: StoredPair[] = await Promise.all(
    pairs.map(async (pair) => ({
      privateKey: await exportJwk(pair.privateKey),
      publicKey: await exportJwk(pair.publicKey),
    })),
  );
  writeFileSync(path, JSON.stringify(stored), { mode: 0o600, flag: "wx" });
  return pairs;
}
