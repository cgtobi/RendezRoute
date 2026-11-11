// The instance actor's signing keys (spec 3.11, 10; decision D36): RSA for Mastodon's HTTP
// signatures and Ed25519 for newer servers, generated on first start in the key directory.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJwk } from "@fedify/fedify";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  actorKeyFactory,
  loadOrCreateInstanceKeys,
  parseKeyPairs,
} from "../../../src/adapters/out/crypto/federation-keys.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const keyDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "rendezroute-federation-"));
  dirs.push(dir);
  return dir;
};

describe("the instance actor's keys (decision D36)", () => {
  it("are created once in the key directory, readable only by the owner, and reused", async () => {
    const dir = keyDir();
    const first = await loadOrCreateInstanceKeys(dir);
    expect(first.map((pair) => pair.privateKey.algorithm.name)).toEqual([
      "RSASSA-PKCS1-v1_5",
      "Ed25519",
    ]);
    expect(readdirSync(dir)).toEqual(["federation-instance.json"]);
    expect(statSync(join(dir, "federation-instance.json")).mode & 0o777).toBe(0o600);
    const again = await loadOrCreateInstanceKeys(dir);
    for (const [index, pair] of first.entries()) {
      expect(await exportJwk(again[index]?.publicKey as CryptoKey)).toEqual(
        await exportJwk(pair.publicKey),
      );
    }
  });

  it("refuses a key file whose keys are not RSA then Ed25519", async () => {
    const dir = keyDir();
    await loadOrCreateInstanceKeys(dir);
    const path = join(dir, "federation-instance.json");
    const stored = JSON.parse(readFileSync(path, "utf8")) as unknown[];
    writeFileSync(path, JSON.stringify([...stored].reverse()));
    await expect(loadOrCreateInstanceKeys(dir)).rejects.toThrow(/federation-instance\.json/);
  });

  it("refuses a damaged key file instead of silently replacing it", async () => {
    const dir = keyDir();
    writeFileSync(join(dir, "federation-instance.json"), "{");
    await expect(loadOrCreateInstanceKeys(dir)).rejects.toThrow(/federation-instance\.json/);
    expect(readFileSync(join(dir, "federation-instance.json"), "utf8")).toBe("{");
  });
});

describe("a poster actor's keys (decision D36)", () => {
  it("are made as RSA then Ed25519 and read back from their stored form", async () => {
    const stored = await actorKeyFactory.generate();
    const pairs = await parseKeyPairs(stored);
    expect(pairs.map((pair) => pair.publicKey.algorithm.name)).toEqual([
      "RSASSA-PKCS1-v1_5",
      "Ed25519",
    ]);
    // Two profiles never share keys.
    expect(await actorKeyFactory.generate()).not.toBe(stored);
  });
});
