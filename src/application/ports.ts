import type { GeoPoint } from "../domain/geo.ts";
import type { JobType } from "../domain/jobs.ts";
import type { Notification } from "../domain/notification.ts";
import type { PushSubscription } from "../domain/push.ts";
import type { RecapContribution } from "../domain/recap.ts";
import type { Plan } from "../domain/plan.ts";
import type { ReminderKind } from "../domain/reminders.ts";
import type { PlanResponse, ResponseKind } from "../domain/response.ts";
import type { Result } from "../domain/result.ts";
import type { Route, RouteError } from "../domain/route.ts";
import type { PlanPreview } from "./plan-views.ts";

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
  "plan_templates.exact_location",
  "plan_templates.route_geojson",
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
  /** Sends a body; redirects are returned, not followed. */
  post(
    url: URL,
    options: {
      headers?: Readonly<Record<string, string>>;
      body: Uint8Array;
      maxBytes?: number;
      timeoutMs?: number;
    },
  ): Promise<OutboundResponse>;
}

export interface NewPlan {
  plan: Plan;
  hostTokenHash: string;
  /** One-time value from the create form; detects resubmission (decision I9). */
  creationNonce: string;
  hostDeviceId: string;
  /** Stored with the plan when the poster uploaded a GPX file. */
  route?: Route | undefined;
}

export interface PlanRepository {
  /** Stores the plan, its creation nonce and the host device link in one transaction. */
  create(input: NewPlan): Promise<void>;
  findById(id: string): Promise<Plan | undefined>;
  findByHostTokenHash(hash: string): Promise<Plan | undefined>;
  findIdByCreationNonce(nonce: string): Promise<string | undefined>;
  /** Stores every field of an existing plan. */
  update(plan: Plan): Promise<void>;
  /** Hard delete of the plan and everything referencing it, physically removed from disk (spec 1.6, 3.10). */
  delete(id: string): Promise<void>;
  /** Like delete, for several plans in one transaction (retention sweep). */
  deleteMany(ids: readonly string[]): Promise<void>;
  /** IDs of plans whose delete_at is at or before `now`, cancelled plans included (spec 3.10). */
  findDueForDeletion(now: Date): Promise<string[]>;
  /** Active plans starting within the range, bounds included (spec 6 feature 3: day-before reminder). */
  findActiveStartingBetween(from: Date, to: Date): Promise<Plan[]>;
  /** Active plans being deleted within the range, bounds included (spec 3.10: deletion reminder). */
  findActiveDeletingBetween(from: Date, to: Date): Promise<Plan[]>;
  /** Plans the device hosts or manages a response to, with the response's kind (spec 6 feature 2). */
  findLinkedToDevice(deviceId: string): Promise<LinkedPlan[]>;
  /** Plans whose retention exceeds `maxRetentionDays` (apply-retention-max). */
  findWithRetentionAbove(maxRetentionDays: number): Promise<Plan[]>;
  /** The route, decrypted; only for audiences that may see it (spec 3.6). */
  findRoute(planId: string): Promise<Route | undefined>;
  /** Adds or replaces the plan's route. */
  saveRoute(planId: string, route: Route): Promise<void>;
  /** Removes the plan's route, physically (spec 3.10). */
  deleteRoute(planId: string): Promise<void>;
  /** The cached preview image of this plan version, if any; deleted with the plan (spec 3.10). */
  findPreview(planId: string, version: string): Promise<Uint8Array | undefined>;
  /** Replaces the plan's cached preview image. */
  savePreview(planId: string, version: string, image: Uint8Array): Promise<void>;
}

/** A plan as seen from one device: hosted, or responded to with a response of some kind. */
export type LinkedPlan =
  | { plan: Plan; role: "host" }
  | { plan: Plan; role: "manage"; responseKind: ResponseKind };

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
  /** Deletes devices without links last seen before the first cutoff, and any device before the second. */
  deleteInactive(cutoffs: {
    unlinkedLastSeenBefore: Date;
    anyLastSeenBefore: Date;
  }): Promise<number>;
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
  /** Hard delete, including device links, physically removed from disk (spec 1.6, 3.10). */
  delete(id: string): Promise<void>;
  /** True if this device was rejected or removed for this plan (spec 3.5). */
  isBlocked(planId: string, deviceId: string): Promise<boolean>;
}

export type RouteParseError = RouteError | "route_too_large" | "route_unsafe" | "route_unreadable";

/** GPX → route, within the upload limits (spec 2a, 3.8). */
export interface RouteParser {
  parse(file: Uint8Array): Result<Route, RouteParseError>;
}

/** Server-side map tiles for preview images (spec 2a); public data, cached at most 7 days. */
export interface MapTiles {
  tile(z: number, x: number, y: number): Promise<Uint8Array | undefined>;
}

/** Open Graph card image (spec 2a); "busy" when rendering capacity is exhausted. */
export interface PreviewRenderer {
  render(preview: PlanPreview): Promise<Result<Uint8Array, "busy">>;
}

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

/** Place name → coordinates (spec 3.9). Throws when the service is unavailable. */
export interface Geocoder {
  search(query: string, options: { language: string }): Promise<Place[]>;
}

/** Pre-migration database backups (spec 11), deleted after 7 days by housekeeping. */
export interface BackupStore {
  /** Deletes backups created before the cutoff and returns how many. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

/** A job to run later (spec 4 job_queue); deleted with its plan or response by the database. */
export interface NewJob {
  type: JobType;
  /** Stored encrypted; must be JSON. */
  payload: unknown;
  planId?: string | undefined;
  responseId?: string | undefined;
  runAt: Date;
  /** Dropped unrun after this time. */
  expiresAt?: Date | undefined;
}

export interface QueuedJob {
  id: string;
  type: string;
  payload: unknown;
  /** Failed attempts so far. */
  attempts: number;
  expiresAt: Date | undefined;
}

export interface JobQueue {
  enqueue(job: NewJob): Promise<string>;
  /** Jobs whose time has come, earliest first. */
  due(now: Date, limit: number): Promise<QueuedJob[]>;
  /** Removes a job that is done or given up. */
  complete(id: string): Promise<void>;
  /** Records a failure (error class only) and runs the job again at `runAt`. */
  retry(id: string, runAt: Date, error: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

/**
 * "gone": the channel no longer exists (e.g. an expired push subscription) and can be deleted;
 * "failed": this message was refused for good, the channel stays.
 */
export type SendResult = "sent" | "gone" | "retry" | "failed";

/**
 * Where a notification goes: a stored channel, or a subscription carried by the job itself, for
 * messages that outlive their plan and its channels (spec 3.10 deletion notifications).
 */
export type NotificationTarget = { channelId: string } | { subscription: PushSubscription };

/** Delivers a notification (spec 2a); one adapter per channel kind. */
export interface Notifier {
  send(to: NotificationTarget, notification: Notification): Promise<SendResult>;
}

/** A reminder for one response, or for a whole plan, at the moment it was due (decision I39). */
export interface SentReminder {
  kind: ReminderKind;
  planId: string;
  responseId?: string | undefined;
  /** What it is about: the day-before moment, or the deletion date of a deletion reminder. */
  dueAt: Date;
}

/** Remembers which reminders went out; deleted with their plan or response. */
export interface SentReminderRepository {
  wasSent(reminder: SentReminder): Promise<boolean>;
  /** Idempotent. */
  record(reminder: SentReminder): Promise<void>;
}

/** Who a notification channel belongs to: a response, or the host of a plan (spec 4). */
export type ChannelOwner = { responseId: string } | { planId: string };

export interface NotificationChannel {
  id: string;
  owner: ChannelOwner;
  subscription: PushSubscription;
}

/** Browser push subscriptions per response or hosted plan (spec 6 feature 3), stored encrypted. */
export interface ChannelRepository {
  /** Adds a subscription, or returns the existing channel with the same endpoint. */
  add(owner: ChannelOwner, subscription: PushSubscription): Promise<string>;
  remove(owner: ChannelOwner, endpoint: string): Promise<void>;
  has(owner: ChannelOwner, endpoint: string): Promise<boolean>;
  /** Oldest first. */
  listFor(owner: ChannelOwner): Promise<NotificationChannel[]>;
  findById(id: string): Promise<NotificationChannel | undefined>;
  delete(id: string): Promise<void>;
}

/** A personal calendar feed (spec 6 feature 2); only the hash of its token is stored. */
export interface CalendarFeed {
  id: string;
  deviceId: string;
  /** For the feed's texts: calendar servers fetch it without the browser's preferences. */
  language: string;
  createdAt: Date;
}

export interface CalendarFeedRepository {
  /** Stores the device's feed, replacing any earlier one, whose link then stops working. */
  replace(feed: CalendarFeed & { tokenHash: string }): Promise<void>;
  findByTokenHash(hash: string): Promise<CalendarFeed | undefined>;
  findForDevice(deviceId: string): Promise<CalendarFeed | undefined>;
  deleteForDevice(deviceId: string): Promise<void>;
  /** Deletes feeds whose device has nothing linked any more (spec 3.10); returns how many. */
  deleteUnlinked(): Promise<number>;
}

/** A forecast for one hour at one point, in metric units (spec 3.9). */
export interface Forecast {
  /** WMO weather interpretation code; undefined where the weather model has none. */
  weatherCode: number | undefined;
  temperatureC: number;
  /** Percent; undefined where the weather model has none. */
  precipitationProbability: number | undefined;
  windKmh: number;
}

/**
 * Weather (spec 2a, optional). Asked only for a public point and an hour, never about a person;
 * undefined when the service has no forecast for that hour.
 */
export interface WeatherProvider {
  forecast(point: GeoPoint, hour: Date): Promise<Forecast | undefined>;
}

/** Recap contributions (spec 6 feature 5); comment and link encrypted at rest. */
export interface RecapRepository {
  create(contribution: RecapContribution): Promise<void>;
  /** Stores comment, link, hidden flag and update time. */
  update(contribution: RecapContribution): Promise<void>;
  findById(id: string): Promise<RecapContribution | undefined>;
  /** Oldest first. */
  listByPlan(planId: string): Promise<RecapContribution[]>;
  countByPlan(planId: string): Promise<number>;
  /** Contributions of one response, or of the host for undefined. */
  countByAuthor(planId: string, responseId: string | undefined): Promise<number>;
  /** Physical deletes (spec 3.10); deleting a plan's returns how many. */
  delete(id: string): Promise<void>;
  deleteForResponse(responseId: string): Promise<void>;
  deleteForPlan(planId: string): Promise<number>;
}
