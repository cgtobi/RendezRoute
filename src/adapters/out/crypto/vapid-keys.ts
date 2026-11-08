// The instance's VAPID key pair for Web Push (spec 10): generated on first start and kept in the
// key directory next to the encryption key. Replacing it would end every push subscription, so a
// damaged file stops the app instead of being overwritten.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VapidKeys } from "../push/vapid.ts";

const FILE = "vapid.json";

export function loadOrCreateVapidKeys(directory: string): VapidKeys {
  const path = join(directory, FILE);
  if (existsSync(path)) {
    try {
      const stored = JSON.parse(readFileSync(path, "utf8")) as Partial<VapidKeys>;
      if (typeof stored.publicKey === "string" && typeof stored.privateKey === "string") {
        return { publicKey: stored.publicKey, privateKey: stored.privateKey };
      }
    } catch {
      // Reported below.
    }
    throw new Error(`The Web Push key file ${path} is damaged. Restore it from a backup.`);
  }
  const keys = generateVapidKeys();
  writeFileSync(path, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
  return keys;
}

/** A new P-256 key pair; JWK export keeps the private scalar at its full 32 bytes. */
export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? "", "base64url"),
    Buffer.from(jwk.y ?? "", "base64url"),
  ]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d ?? "" };
}
