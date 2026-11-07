import type { Plan } from "../domain/plan.ts";
import type { PlanResponse } from "../domain/response.ts";

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

export interface NewPlan {
  plan: Plan;
  hostTokenHash: string;
  /** One-time value from the create form; detects resubmission (decision I9). */
  creationNonce: string;
  hostDeviceId: string;
}

export interface PlanRepository {
  /** Stores the plan, its creation nonce and the host device link in one transaction. */
  create(input: NewPlan): Promise<void>;
  findById(id: string): Promise<Plan | undefined>;
  findByHostTokenHash(hash: string): Promise<Plan | undefined>;
  findIdByCreationNonce(nonce: string): Promise<string | undefined>;
}

export interface Device {
  id: string;
  lastSeenAt: Date;
}

/** What a device is linked to, and in which role (spec 3.2). */
export type DeviceLinkTarget =
  | { role: "host"; planId: string }
  | { role: "manage"; responseId: string };

export interface DeviceRepository {
  findByTokenHash(hash: string): Promise<Device | undefined>;
  create(device: { id: string; tokenHash: string; now: Date }): Promise<void>;
  touch(id: string, now: Date): Promise<void>;
  /** Idempotent. */
  link(deviceId: string, target: DeviceLinkTarget, now: Date): Promise<void>;
  hasLink(deviceId: string, target: DeviceLinkTarget): Promise<boolean>;
}

export interface NewResponse {
  response: PlanResponse;
  manageTokenHash: string;
  /** One-time value from the response form; detects double submits. */
  creationNonce: string;
  /** Linked as manager and kept for blocks; undefined only in tests and imports. */
  deviceId: string | undefined;
}

export interface ResponseRepository {
  /** Stores the response and links the device as manager, in one transaction. */
  create(input: NewResponse): Promise<void>;
  findById(id: string): Promise<PlanResponse | undefined>;
  findByManageTokenHash(hash: string): Promise<PlanResponse | undefined>;
  findIdByCreationNonce(nonce: string): Promise<string | undefined>;
  /** The response a device manages for a plan, if any (one per device and plan). */
  findForDevice(planId: string, deviceId: string): Promise<PlanResponse | undefined>;
  listByPlan(planId: string): Promise<PlanResponse[]>;
  /** Interested and joined counts; rejected and removed people never count (spec 3.5). */
  counts(planId: string): Promise<{ interested: number; participants: number }>;
  /** Updates kind, display name and previous kind. */
  update(response: PlanResponse): Promise<void>;
  /** Hard delete, including device links (spec 1.6). */
  delete(id: string): Promise<void>;
  /** True if this device was rejected or removed for this plan (spec 3.5). */
  isBlocked(planId: string, deviceId: string): Promise<boolean>;
}
