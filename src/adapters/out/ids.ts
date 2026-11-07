import { randomBytes, randomUUIDv7 } from "node:crypto";
import type { IdGenerator } from "../../application/ports.ts";

export function createIdGenerator(): IdGenerator {
  return {
    planId: () => randomBytes(16).toString("base64url"),
    rowId: () => randomUUIDv7(),
  };
}
