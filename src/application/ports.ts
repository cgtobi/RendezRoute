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

export interface FieldCipher {
  /** Encrypts a private field. `context` names the field and is authenticated, not stored. */
  encrypt(plaintext: string, context: string): string;
  /** Throws if the value was tampered with or the context does not match. */
  decrypt(ciphertext: string, context: string): string;
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
