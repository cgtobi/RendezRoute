// Actors' signing keys (spec 3.11, 10; decision D36): RSA for Mastodon's HTTP signatures and
// Ed25519 for newer servers, always in that order. The instance actor's are generated on first
// start and kept in the key directory next to the encryption and VAPID keys; replacing them would
// make other servers distrust the instance actor, so a damaged file stops the app instead of
// being overwritten. A poster actor's are generated with the profile and stored encrypted in the
// database (decision D36): serialized here, encrypted by the repository.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportJwk, generateCryptoKeyPair, importJwk } from "@fedify/fedify";
import type { ActorKeyFactory } from "../../../application/ports.ts";

const FILE = "federation-instance.json";
const ALGORITHMS = ["RSASSA-PKCS1-v1_5", "Ed25519"] as const;

/** A signing key pair, as Fedify's actor key dispatcher takes it. */
export type SigningKeyPair = Awaited<ReturnType<typeof generateCryptoKeyPair>>;
type Jwk = Awaited<ReturnType<typeof exportJwk>>;

interface StoredPair {
  privateKey: Jwk;
  publicKey: Jwk;
}

const generateKeyPairs = () =>
  Promise.all(ALGORITHMS.map((algorithm) => generateCryptoKeyPair(algorithm)));

/** The pairs as JSON: private and public JWKs, RSA first. */
export async function serializeKeyPairs(pairs: readonly SigningKeyPair[]): Promise<string> {
  const stored: StoredPair[] = await Promise.all(
    pairs.map(async (pair) => ({
      privateKey: await exportJwk(pair.privateKey),
      publicKey: await exportJwk(pair.publicKey),
    })),
  );
  return JSON.stringify(stored);
}

/** The pairs from their JSON; throws unless they are RSA then Ed25519. */
export async function parseKeyPairs(json: string): Promise<SigningKeyPair[]> {
  const stored = JSON.parse(json) as StoredPair[];
  if (!Array.isArray(stored) || stored.length !== ALGORITHMS.length) {
    throw new Error("Not a pair of actor keys.");
  }
  const pairs = await Promise.all(
    stored.map(async (pair) => ({
      privateKey: await importJwk(pair.privateKey, "private"),
      publicKey: await importJwk(pair.publicKey, "public"),
    })),
  );
  // RSA first: Mastodon's signatures use the first key (federation.ts publicKey).
  if (!pairs.every((pair, index) => pair.privateKey.algorithm.name === ALGORITHMS[index])) {
    throw new Error("Actor keys out of order.");
  }
  return pairs;
}

export async function loadOrCreateInstanceKeys(directory: string): Promise<SigningKeyPair[]> {
  const path = join(directory, FILE);
  if (existsSync(path)) {
    try {
      return await parseKeyPairs(readFileSync(path, "utf8"));
    } catch {
      throw new Error(`The federation key file ${path} is damaged. Restore it from a backup.`);
    }
  }
  const pairs = await generateKeyPairs();
  writeFileSync(path, await serializeKeyPairs(pairs), { mode: 0o600, flag: "wx" });
  return pairs;
}

/** Keys for a new poster actor (decision D36). */
export const actorKeyFactory: ActorKeyFactory = {
  generate: async () => serializeKeyPairs(await generateKeyPairs()),
};
