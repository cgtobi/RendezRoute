import type { Migration } from "kysely/migration";
import * as m0001 from "./0001-instance-meta.ts";

/** Statically imported so migrations work identically from src/ and dist/. Keys sort in order. */
export const migrations: Readonly<Record<string, Migration>> = {
  "0001-instance-meta": m0001,
};
