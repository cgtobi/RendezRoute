import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { loadOrCreateVapidKeys } from "../../../src/adapters/out/crypto/vapid-keys.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const keyDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "rendezroute-vapid-"));
  dirs.push(dir);
  return dir;
};

describe("VAPID keys (spec 10: generated on first start in the key directory)", () => {
  it("are created once, readable only by the owner, and reused", () => {
    const dir = keyDir();
    const first = loadOrCreateVapidKeys(dir);
    expect(first.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    expect(first.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(join(dir, "vapid.json")).mode & 0o777).toBe(0o600);
    expect(loadOrCreateVapidKeys(dir)).toEqual(first);
  });

  it("refuses a damaged key file instead of silently replacing it", () => {
    const dir = keyDir();
    writeFileSync(join(dir, "vapid.json"), "{");
    expect(() => loadOrCreateVapidKeys(dir)).toThrow(/vapid\.json/);
    expect(readFileSync(join(dir, "vapid.json"), "utf8")).toBe("{");
  });
});
