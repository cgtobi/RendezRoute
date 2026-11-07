import { createHash, randomBytes } from "node:crypto";
import type { TokenService } from "../../application/ports.ts";

/** 256 bits: above the spec's 128-bit minimum and distinguishable from 22-character plan IDs. */
const TOKEN_BYTES = 32;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createTokenService(): TokenService {
  return {
    generate: () => randomBytes(TOKEN_BYTES).toString("base64url"),
    hash: sha256Hex,
  };
}
