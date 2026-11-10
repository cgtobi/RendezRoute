import type { GeoPoint } from "../domain/geo.ts";
import type { Identity, IdentityProviderKind } from "../domain/identity.ts";
import type { Invite } from "../domain/invite.ts";
import type { Report, ReportReason } from "../domain/report.ts";
import type { JobType } from "../domain/jobs.ts";
import type { Notification } from "../domain/notification.ts";
import type { PushSubscription } from "../domain/push.ts";
import type { PlanRating } from "../domain/rating.ts";
import type { RecapContribution } from "../domain/recap.ts";
import type { Plan } from "../domain/plan.ts";
import type { ReminderKind } from "../domain/reminders.ts";
import type { PlanResponse, ResponseKind } from "../domain/response.ts";
import type { Result } from "../domain/result.ts";
import type { Route, RouteError } from "../domain/route.ts";
import type { PlanTemplate } from "../domain/template.ts";
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
  "plan_ratings.note",
  "notification_channels.config",
  "job_queue.payload",
  "reports.details",
  "reports.attached_content",
  "identities.subject",
  "identities.display_name",
  "pending_logins.secrets",
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
  /** "Get a new link": the old host link stops working (spec 3.2). */
  setHostTokenHash(planId: string, hash: string): Promise<void>;
  /** Stores every field of an existing plan. */
  update(plan: Plan): Promise<void>;
  /** Hard delete of the plan and everything referencing it, physically removed from disk (spec 1.6, 3.10). */
  delete(id: string): Promise<void>;
  /** Like delete, for several plans in one transaction; templates kept from them are stored in it too. */
  deleteMany(ids: readonly string[], templates?: readonly NewTemplate[]): Promise<void>;
  /** Plans whose delete_at is at or before `now`, cancelled plans included (spec 3.10). */
  findDueForDeletion(now: Date): Promise<Plan[]>;
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
  /** The account logged in on this device, if any (spec 7 Identity). */
  identityId: string | undefined;
}

/** What a device is linked to, and in which role (spec 3.2). */
export type DeviceLinkTarget =
  | { role: "host"; planId: string }
  | { role: "manage"; responseId: string }
  | { role: "template"; templateId: string };

/** A template to store, with the plan whose host devices get linked to it (spec 3.10). */
export interface NewTemplate {
  template: PlanTemplate;
  /** Undefined for templates kept at deletion: no link is shown then (decision I36). */
  hostTokenHash: string | undefined;
  /** Only when the template includes the exact start and route. */
  route: Route | undefined;
  /** The plan ID whose host devices get linked to the template. */
  hostsOfPlan: string;
  /** One-time value from the "Save as template" form; detects resubmission (decision I9). */
  creationNonce?: string | undefined;
}

/** Invite links (spec 7 Moderation); only their token hashes are stored. */
export interface InviteRepository {
  create(invite: Invite, tokenHash: string): Promise<void>;
  findByTokenHash(hash: string): Promise<Invite | undefined>;
  /** Every invite, newest first. */
  list(): Promise<Invite[]>;
  /** Whether the invite exists; revoking it again keeps the first time. */
  revoke(id: string, at: Date): Promise<boolean>;
  /**
   * Lets the device post through the invite, in one step: a device that may already post uses
   * nothing; otherwise one use is counted, but only while the invite is usable at `now`.
   */
  redeem(request: {
    inviteId: string;
    deviceId: string;
    permissionId: string;
    now: Date;
  }): Promise<"granted" | "already_allowed" | "unusable">;
}

/** What a device or account may do beyond the defaults (spec 3.10 Other expiry counts these as links). */
export interface PermissionRepository {
  /** When the device, or the account logged in on it, became allowed to post, if it is. */
  mayPostSince(deviceId: string): Promise<Date | undefined>;
  /** The device's own permission only, which goes with the device's data (spec 3.7). */
  deviceMayPostSince(deviceId: string): Promise<Date | undefined>;
}

/** Accounts (spec 7 Identity): subject and display name encrypted, looked up by a keyed hash. */
export interface IdentityRepository {
  create(identity: Identity, subjectHash: string): Promise<void>;
  findBySubjectHash(
    provider: IdentityProviderKind,
    subjectHash: string,
  ): Promise<Identity | undefined>;
  findById(id: string): Promise<Identity | undefined>;
  setDisplayName(id: string, displayName: string | undefined): Promise<void>;
  touch(id: string, now: Date): Promise<void>;
}

/** Keyed hash for finding encrypted values (spec 3.11: account identities). */
export interface LookupHasher {
  hash(value: string): string;
}

/** The one-time values a login checks on its way back: never sent anywhere but where they belong. */
export interface LoginSecrets {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** A login started and not finished yet (at most LOGIN_WINDOW_MINUTES); encrypted at rest. */
export interface PendingLogin {
  provider: IdentityProviderKind;
  secrets: LoginSecrets;
  startedAt: Date;
}

export interface PendingLoginRepository {
  create(stateHash: string, login: PendingLogin): Promise<void>;
  /** Removes and returns the pending login: each can be finished once. */
  take(stateHash: string): Promise<PendingLogin | undefined>;
  deleteStartedBefore(cutoff: Date): Promise<number>;
}

/** Who logged in, as the provider says. */
export interface ProviderAccount {
  /** Stable for the account at this provider, issuer included. */
  subject: string;
  /** Names the provider offers, best first; the first valid one becomes the display name. */
  names: (string | undefined)[];
}

/**
 * A way to log in (spec 7 Identity, 3.11 Account takeover): PKCE, state, nonce and exact redirect
 * matching are the adapter's job; it keeps no tokens.
 */
export interface IdentityProvider {
  /** Where to send the browser, with the one-time values the callback must match. */
  startLogin(): Promise<{ authorizationUrl: URL; secrets: LoginSecrets }>;
  /** Checks the provider's answer at the callback URL against the login's one-time values. */
  finishLogin(
    callback: URL,
    secrets: LoginSecrets,
  ): Promise<{ ok: true; account: ProviderAccount } | { ok: false }>;
}

/** Reports to the instance admin (spec 7 Moderation); details and attachments encrypted at rest. */
export interface ReportRepository {
  create(report: Report): Promise<void>;
  /** Unresolved reports, oldest first, with their plan's public title; nothing is decrypted. */
  listOpen(): Promise<OpenReportRow[]>;
  /** The plan's unresolved reports, oldest first, decrypted. */
  listOpenForPlan(planId: string): Promise<Report[]>;
  countResolvedForPlan(planId: string): Promise<number>;
  /** Marks a report resolved: its plan and whether it was still open; undefined if unknown. */
  resolve(id: string, at: Date): Promise<{ planId: string; wasOpen: boolean } | undefined>;
}

/** An open report as the admin's home lists it: what it is about, not what it says. */
export interface OpenReportRow {
  planId: string;
  planTitle: string;
  reason: ReportReason;
}

/** Plan ratings (spec 6a); the note encrypted at rest. */
export interface RatingRepository {
  findByResponse(responseId: string): Promise<PlanRating | undefined>;
  /** Oldest first; only for the host's result once it is due (decision D20). */
  listByPlan(planId: string): Promise<PlanRating[]>;
  /** Adds or replaces the response's one rating. */
  save(rating: PlanRating): Promise<void>;
  /** Physical delete (spec 3.10). */
  deleteForResponse(responseId: string): Promise<void>;
}

/**
 * Authenticates the instance admin (spec 2a, 7 Moderation): `ADMIN_TOKEN` now; an OIDC admin group
 * and Home Assistant Ingress later.
 */
export interface AdminAuth {
  /** Whether the presented secret is the admin's; never leaks how close a guess was. */
  checkToken(candidate: string): boolean;
  /** A new session value for an admin who just authenticated, valid until `expiresAt`. */
  startSession(now: Date): { value: string; expiresAt: Date };
  /** Whether a session value is one this instance issued and has not expired. */
  hasSession(value: string, now: Date): boolean;
}

/** One-time form values that were used (decision I44); kept for a day. */
export interface FormNonceRepository {
  /** True the first time a value is claimed, false when the form was sent again. */
  claim(nonce: string, now: Date): Promise<boolean>;
  deleteUsedBefore(cutoff: Date): Promise<number>;
}

/** Repeatable templates (spec 3.10); exact start and route encrypted at rest. */
export interface TemplateRepository {
  /** Stores the template and links the plan's host devices to it, in one transaction. */
  create(input: NewTemplate): Promise<void>;
  findById(id: string): Promise<PlanTemplate | undefined>;
  findByHostTokenHash(hash: string): Promise<PlanTemplate | undefined>;
  findIdByCreationNonce(nonce: string): Promise<string | undefined>;
  /** "Get a new link", also for templates kept without one (spec 3.2, decision I36). */
  setHostTokenHash(templateId: string, hash: string): Promise<void>;
  /** Stores every field but the route. */
  update(template: PlanTemplate): Promise<void>;
  /** A repeat or edit: the template stays until `expiresAt` (spec 3.10). */
  markUsed(id: string, lastUsedAt: Date, expiresAt: Date): Promise<void>;
  /** The route, decrypted; only for devices linked to the template. */
  findRoute(id: string): Promise<Route | undefined>;
  /** Removes the route, physically (spec 3.10). */
  deleteRoute(id: string): Promise<void>;
  /** Physical delete (spec 3.10). */
  delete(id: string): Promise<void>;
  /** The templates linked to a device, by title. */
  listForDevice(deviceId: string): Promise<PlanTemplate[]>;
  /** Deletes templates whose expiry has passed; returns how many (spec 3.10). */
  deleteExpired(now: Date): Promise<number>;
}

export interface DeviceRepository {
  findByTokenHash(hash: string): Promise<Device | undefined>;
  create(device: { id: string; tokenHash: string; now: Date }): Promise<void>;
  touch(id: string, now: Date): Promise<void>;
  /** Idempotent. */
  link(deviceId: string, target: DeviceLinkTarget, now: Date): Promise<void>;
  hasLink(deviceId: string, target: DeviceLinkTarget): Promise<boolean>;
  /** Logs the device in to an account, or out of it (undefined). */
  setIdentity(deviceId: string, identityId: string | undefined): Promise<void>;
  /** A new cookie token for the device; the old one stops working, its links stay. */
  replaceToken(deviceId: string, tokenHash: string): Promise<void>;
  /**
   * "Sign out all other devices": removes the target's links of every other device, in one step and
   * only while the kept device is still linked, so two devices signing out at once cannot remove
   * each other (spec 3.2).
   */
  unlinkOthers(target: DeviceLinkTarget, keepDeviceId: string): Promise<number>;
  /** "Delete my data": the device with its links and calendar feed, physically (spec 3.7). */
  delete(id: string): Promise<void>;
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
  /** "Get a new link": the old manage link stops working (spec 3.2). */
  setManageTokenHash(responseId: string, hash: string): Promise<void>;
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
