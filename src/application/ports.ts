// Driven ports (spec 2a). Use cases receive implementations as arguments;
// adapters in src/adapters/out implement them, fakes live in test/fakes.

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** 128 random bits, base64url; appears in public URLs (decision P1). */
  planId(): string;
  /** Internal row ID (UUIDv7). */
  rowId(): string;
}

export interface TokenService {
  /** New secret token for a host, manage or template link (spec 3.2). */
  generate(): string;
  /** SHA-256 of a token; only hashes are stored. */
  hash(token: string): string;
}

/** Every encrypted column (spec 3.11, section 4), named `<table>.<column without _enc>`. */
export const ENCRYPTED_FIELDS = [
  "plans.exact_location",
  "routes.geojson",
  "routes.gpx_file",
  "plan_templates.exact_location",
  "plan_templates.route_geojson",
  "plan_templates.gpx_file",
  "responses.display_name",
  "responses.request_note",
  "responses.remote_actor",
  "recap_contributions.body",
  "recap_contributions.link_url",
  "notification_channels.config",
  "job_queue.payload",
  "reports.details",
  "reports.attached_content",
  "identities.subject",
  "identities.display_name",
] as const;
export type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];

export interface FieldCipher {
  /** Encrypts a private field. The field name is authenticated, not stored (decision I16). */
  encrypt(plaintext: string, field: EncryptedField): string;
  /** Throws if the value was tampered with or belongs to a different field. */
  decrypt(ciphertext: string, field: EncryptedField): string;
}

export interface OutboundResponse {
  status: number;
  /** Final URL after redirects. */
  url: URL;
  /** Lower-cased header names. */
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

/** The only way adapters reach the network; enforces SSRF rules (spec 3.11). */
export interface OutboundHttp {
  get(
    url: URL,
    options?: { headers?: Readonly<Record<string, string>>; maxBytes?: number; timeoutMs?: number },
  ): Promise<OutboundResponse>;
}
