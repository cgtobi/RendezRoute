// Table types for Kysely (spec section 4). Must match the migrations in ./migrations;
// repository integration tests and the schema conformance test catch drift.

export interface InstanceMetaTable {
  key: string;
  value: string;
}

export interface DatabaseSchema {
  /** Instance-level values, e.g. the encryption key fingerprint (spec 3.11). */
  instance_meta: InstanceMetaTable;
}
