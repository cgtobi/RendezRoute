import type { ActivityType } from "../domain/activity.ts";
import type { BoundingBox } from "../domain/nearby.ts";
import type { GeoPoint } from "../domain/geo.ts";
import type { Identity, IdentityProviderKind } from "../domain/identity.ts";
import type { Invite } from "../domain/invite.ts";
import type { Report, ReportReason } from "../domain/report.ts";
import type { JobType } from "../domain/jobs.ts";
import type { Notification } from "../domain/notification.ts";
import type { PushSubscription } from "../domain/push.ts";
import type { PlanRating } from "../domain/rating.ts";
import type { RecapContribution } from "../domain/recap.ts";
import type { Plan, PlanStatus } from "../domain/plan.ts";
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
  "identities.handle",
  // Poster actors' signing keys (decision D36).
  "fediverse_profiles.keys",
  // Who follows the instance's actors (decision D38).
  "fediverse_followers.remote",
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
  /** Logged in: the plan belongs to the account, and the device gets no link of its own (5a). */
  ownerIdentityId?: string | undefined;
  /** Stored with the plan when the poster uploaded a GPX file. */
  route?: Route | undefined;
}

export interface PlanRepository {
  /** Stores the plan, its creation nonce and the host device link in one transaction. */
  create(input: NewPlan): Promise<void>;
  findById(id: string): Promise<Plan | undefined>;
  findByHostTokenHash(hash: string): Promise<Plan | undefined>;
  findIdByCreationNonce(nonce: string): Promise<string | undefined>;
  /** The account the plan belongs to, if any (step 5a); decides whether it may be public (D35). */
  ownerOf(planId: string): Promise<string | undefined>;
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
  /**
   * Active public plans with a point inside the box, starting in [from, to), of the activity if
   * given, by start, one page at a time (spec 7 Nearby): the candidates; the exact distance and
   * the other filters are the domain's (decision I59).
   */
  findPublicIn(
    box: BoundingBox,
    window: { from: Date; to: Date },
    page: { activity: ActivityType | undefined; limit: number; offset: number },
  ): Promise<Plan[]>;
  /** Active plans being deleted within the range, bounds included (spec 3.10: deletion reminder). */
  findActiveDeletingBetween(from: Date, to: Date): Promise<Plan[]>;
  /** Plans the device hosts or manages a response to, with the response's kind (spec 6 feature 2). */
  /** Plans the device hosts or responded to; with its account's too for "device_and_account". */
  findLinkedToDevice(deviceId: string, scope: AccessScope): Promise<LinkedPlan[]>;
  /** Plans the account owns, and plans it responded to (step 5b), by start. */
  findOwnedBy(identityId: string): Promise<LinkedPlan[]>;
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
  | { plan: Plan; role: "manage"; responseId: string; responseKind: ResponseKind };

export interface Device {
  id: string;
  lastSeenAt: Date;
  /** The account logged in on this device, if any (spec 7 Identity). */
  identityId: string | undefined;
}

/**
 * What the device itself links to, what its account owns, or both (steps 5a, 5b). Access checks
 * use both; each export reads as its owner: the browser's or the account's (decision I52).
 */
export type AccessScope = "device" | "account" | "device_and_account";

export interface ClaimCounts {
  plans: number;
  responses: number;
  templates: number;
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
  /** Saved while logged in: the account; otherwise the plan's owner, if any (D25). */
  ownerIdentityId?: string | undefined;
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
  /** The account's own permission only, which goes with the account (step 5b). */
  accountMayPostSince(identityId: string): Promise<Date | undefined>;
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
  /** The account itself; what it owns is removed first (spec 3.7). Its devices are logged out. */
  delete(id: string): Promise<void>;
  /** Accounts last active before the cutoff (spec 3.10 expiry). */
  listUnusedBefore(cutoff: Date): Promise<Identity[]>;
  /**
   * Accounts last active before the cutoff that have not been warned since (decision I52): a
   * warning counts until the account is used again.
   */
  listUnwarnedBefore(cutoff: Date): Promise<Identity[]>;
  markExpiryWarned(id: string, now: Date): Promise<void>;
  /** A fediverse account's handle as shown, after a rename (D23). */
  setHandle(id: string, handle: string | undefined): Promise<void>;
  touch(id: string, now: Date): Promise<void>;
}

/** A poster's fediverse profile while it is active (spec 7 ActivityPub, decision D36). */
export interface FediverseProfile {
  /** The actor's identifier in its URI (`/actors/<id>`), never reused. */
  id: string;
  identityId: string;
  /** The name part of @handle@host. */
  handle: string;
  createdAt: Date;
}

/**
 * Fediverse profiles (decisions D36, D37): one active per account, with its signing keys stored
 * encrypted; a retired one keeps only its identifier and a keyed hash of its handle, so the actor
 * answers as gone and the handle is never taken again.
 */
export interface FediverseProfileRepository {
  findActive(identityId: string): Promise<FediverseProfile | undefined>;
  findByHandle(handle: string): Promise<FediverseProfile | undefined>;
  /** An actor by its identifier, with its keys while active; retired ones only say so. */
  findActor(
    id: string,
  ): Promise<
    | { kind: "active"; profile: FediverseProfile; keys: string }
    | { kind: "retired"; retiredAt: Date }
    | undefined
  >;
  /** Whether the handle is or ever was used, or the account has an active profile. */
  isTaken(profile: { identityId: string; handle: string }): Promise<boolean>;
  /** "taken" as `isTaken` says, checked again as it is stored. */
  create(profile: FediverseProfile & { keys: string }): Promise<"created" | "taken">;
  /**
   * Retires the account's active profile, if any, forgetting its followers in the same step, so
   * no follow accepted meanwhile is left behind (D38); returns its identifier.
   */
  retire(identityId: string, now: Date): Promise<string | undefined>;
}

/** An actor on another server, as far as delivering to it needs (decision D38). */
export interface RemoteActor {
  id: string;
  inbox: string;
  sharedInbox: string | undefined;
}

/**
 * Who follows the instance's actors (decision D38), by the followed actor's identifier
 * ("instance" or a poster actor's). Only the count is ever shown.
 */
export interface FollowerRepository {
  /** Adds the follower, or refreshes its inboxes when it already follows. */
  add(localActor: string, follower: RemoteActor, now: Date): Promise<void>;
  remove(localActor: string, remoteActorId: string): Promise<void>;
  /** Removes a remote actor everywhere, when it is deleted on its server (spec 3.7). */
  forget(remoteActorId: string): Promise<number>;
  count(localActor: string): Promise<number>;
  list(localActor: string): Promise<RemoteActor[]>;
  /** Forgets every follower, while federation is off and nothing can reach them (D38). */
  clear(): Promise<number>;
}

/** Who a plan goes to in the fediverse (spec 7 Addressing): its actor's followers, or everyone. */
export type Audience = "followers" | "public";

/** Who a plan was sent to in the fediverse, and by which local actor (decisions D38, D39). */
export interface PlanPublication {
  planId: string;
  localActor: string;
  audience: Audience;
}

export type PublicationState =
  | { kind: "none" }
  | ({ kind: "published" } & PlanPublication)
  /** Sent `Delete` once: never sent again (D39). */
  | { kind: "withdrawn" };

/** Plans in the fediverse (decisions D38, D39); a plan's row goes with it. */
export interface PublicationRepository {
  find(planId: string): Promise<PublicationState>;
  /** Only a plan that was sent can be withdrawn. */
  /** Those of the given plans that are in the fediverse now. */
  findPublished(planIds: readonly string[]): Promise<PlanPublication[]>;
  /** Records that the plan was sent (`Create`), or to whom it now goes (`Update`). */
  publish(publication: PlanPublication, now: Date): Promise<void>;
  withdraw(planId: string, now: Date): Promise<void>;
  /** Every plan an actor sent, when it is retired: its `Delete` covers them (D37). */
  withdrawAllBy(localActor: string, now: Date): Promise<void>;
}

/** What a plan shows in the fediverse: the public fields its `Event` is made of (spec 3.6, 7). */
export interface PlanEventView {
  id: string;
  title: string;
  note: string | undefined;
  startsAt: Date;
  area: { label: string; point: GeoPoint | undefined };
  status: PlanStatus;
}

/**
 * Activities to other servers (spec 7 ActivityPub, decision D38): queued, signed by the local
 * actor and delivered in the background. Undefined while federation is off.
 */
export interface FederationPublisher {
  /** Answers a `Follow` with `Accept`. */
  acceptFollow(localActor: string, follow: { id: string; follower: RemoteActor }): Promise<void>;
  /** Tells an actor's followers that it is gone for good (decision D37). */
  deleteActor(localActor: string, followers: readonly RemoteActor[]): Promise<void>;
  /** A plan as an `Event`, sent to its audience (`Create`) or sent again changed (`Update`). */
  sendPlan(
    activity: "create" | "update",
    publication: PlanPublication & { event: PlanEventView; language: string },
    followers: readonly RemoteActor[],
  ): Promise<void>;
  /** `Delete` for a plan, to the audience that got it. */
  withdrawPlan(publication: PlanPublication, followers: readonly RemoteActor[]): Promise<void>;
}

/** New signing keys for a poster actor, serialized for storage (decision D36). */
export interface ActorKeyFactory {
  generate(): Promise<string>;
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
  /** Fediverse logins: the server's origin, where the code is exchanged (never the callback's). */
  server?: string | undefined;
  /** Fediverse logins: the app registered at the server for this login only (decision D24). */
  client?: { id: string; secret: string } | undefined;
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
  /** Stable for the account at this provider, issuer or server included; found by its hash. */
  subject: string;
  /** A fediverse account's handle, @name@host, for display (D23). */
  handle?: string | undefined;
  /** Names the provider offers, best first; the first valid one becomes the display name. */
  names: (string | undefined)[];
}

/**
 * A way to log in (spec 7 Identity, 3.11 Account takeover): PKCE, state, nonce and exact redirect
 * matching are the adapter's job; it keeps no tokens.
 */
export interface IdentityProvider {
  /**
   * Where to send the browser, with the one-time values the callback must match. Fediverse logins
   * name the server's origin; throws when the provider cannot be reached.
   */
  startLogin(request?: { server?: string | undefined }): Promise<{
    authorizationUrl: URL;
    secrets: LoginSecrets;
  }>;
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
  listForDevice(deviceId: string, scope: AccessScope): Promise<PlanTemplate[]>;
  /** The templates the account owns (step 5b). */
  listOwnedBy(identityId: string): Promise<PlanTemplate[]>;
  /** Deletes templates whose expiry has passed; returns how many (spec 3.10). */
  deleteExpired(now: Date): Promise<number>;
}

export interface DeviceRepository {
  findByTokenHash(hash: string): Promise<Device | undefined>;
  create(device: { id: string; tokenHash: string; now: Date }): Promise<void>;
  /** Last activity; also the account's the device is logged in to (spec 3.10). */
  touch(id: string, now: Date): Promise<void>;
  /** Idempotent. */
  link(deviceId: string, target: DeviceLinkTarget, now: Date): Promise<void>;
  hasLink(deviceId: string, target: DeviceLinkTarget, scope?: AccessScope): Promise<boolean>;
  /** What the device links to that no account owns yet, which claiming would move. */
  claimable(deviceId: string): Promise<ClaimCounts>;
  /**
   * Claiming (spec 7 Identity): moves the device's own plans, responses and templates that no
   * account owns into this one, in one step; the device's links to them go, other devices' stay.
   */
  claimInto(deviceId: string, identityId: string): Promise<ClaimCounts>;
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
  /** Logged in: the response belongs to the account, and the device gets no link of its own. */
  identityId?: string | undefined;
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
  /** The device's response to the plan, its own first (step 5a); both scopes by default. */
  findForDevice(
    planId: string,
    deviceId: string,
    scope?: AccessScope,
  ): Promise<PlanResponse | undefined>;
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
export type NotificationTarget =
  | { channelId: string }
  | { subscription: PushSubscription }
  /** An email address, carried the same way; nothing is left to turn off once it is gone. */
  | { email: { address: string } }
  /** An ntfy topic, carried the same way, with the server it lives on. */
  | { ntfy: { topic: string; server: string } }
  /** A Telegram chat, carried the same way. */
  | { telegram: { chatId: string } };

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

/**
 * Who a notification channel belongs to: a response, the host of a plan, or an account for its
 * own notices such as the expiry warning (spec 4, decision D31).
 */
export type ChannelOwner = { responseId: string } | { planId: string } | { identityId: string };

interface ChannelBase {
  id: string;
  owner: ChannelOwner;
  /** Confirmed by its owner (spec 3.11); nothing is sent to an unconfirmed channel. */
  verified: boolean;
}

/** A browser's push subscription; the browser confirmed it by subscribing. */
export interface PushChannel extends ChannelBase {
  kind: "webpush";
  subscription: PushSubscription;
}

/** An email address, confirmed through the link sent to it (decision D31). */
export interface EmailChannel extends ChannelBase {
  kind: "email";
  address: string;
  /** An account's address keeps the language it was set in: accounts have none of their own. */
  language: string | undefined;
}

/** An ntfy topic on the instance's server, made by the app (decision D33). */
export interface NtfyChannel extends ChannelBase {
  kind: "ntfy";
  /** Random and unguessable: whoever knows it can read the messages. */
  topic: string;
  /** The server it was made on (NTFY_URL then); after a change of server it gets nothing. */
  server: string;
  /** As for email: an account's topic keeps the language it was set up in. */
  language: string | undefined;
}

/**
 * A Telegram chat with the instance's bot (decision D34): waiting until the person presses Start
 * through the page's deep link, which links their chat and confirms it.
 */
export interface TelegramChannel extends ChannelBase {
  kind: "telegram";
  /** Set by pressing Start; undefined while waiting for it. */
  chatId: string | undefined;
  /** As for email: an account's chat keeps the language it was set up in. */
  language: string | undefined;
}

/**
 * Channels the app confirms with their owner before using them: by a link it sends (email, ntfy)
 * or by the owner starting the bot (Telegram) (decisions D31, D33, D34). Each has a link that
 * turns it off.
 */
export type ConfirmableChannel = EmailChannel | NtfyChannel | TelegramChannel;

export type NotificationChannel = PushChannel | ConfirmableChannel;

/**
 * Browser push subscriptions, email addresses and ntfy topics per response, hosted plan or account
 * (spec 6 feature 3, decisions D31, D33), stored encrypted.
 */
export interface ChannelRepository {
  /**
   * Adds a subscription made in this browser (the app always names it), or returns the existing
   * channel with the same endpoint.
   */
  add(owner: ChannelOwner, subscription: PushSubscription, deviceId?: string): Promise<string>;
  /** Removes the browser's subscriptions for these owners, e.g. its account's items at logout. */
  removeForDevice(deviceId: string, owners: readonly ChannelOwner[]): Promise<void>;
  remove(owner: ChannelOwner, endpoint: string): Promise<void>;
  has(owner: ChannelOwner, endpoint: string): Promise<boolean>;
  /** Oldest first. */
  listFor(owner: ChannelOwner): Promise<NotificationChannel[]>;
  findById(id: string): Promise<NotificationChannel | undefined>;
  delete(id: string): Promise<void>;
  /** Sets the owner's one email address, unconfirmed, replacing any earlier one. */
  setEmail(owner: ChannelOwner, address: string, language?: string): Promise<string>;
  /** Marks a channel confirmed; false when it no longer exists. */
  confirm(id: string): Promise<boolean>;
  emailFor(owner: ChannelOwner): Promise<EmailChannel | undefined>;
  /** Sets the owner's one ntfy topic, unconfirmed, replacing any earlier one (decision D33). */
  setNtfy(
    owner: ChannelOwner,
    topic: { topic: string; server: string },
    language?: string,
  ): Promise<string>;
  ntfyFor(owner: ChannelOwner): Promise<NtfyChannel | undefined>;
  /** Sets the owner's one Telegram channel, waiting for Start, replacing any earlier one (D34). */
  setTelegram(owner: ChannelOwner, language?: string): Promise<string>;
  telegramFor(owner: ChannelOwner): Promise<TelegramChannel | undefined>;
  /** Links the chat that pressed Start and confirms the channel; false when it is gone. */
  attachTelegramChat(id: string, chatId: string): Promise<boolean>;
}

/**
 * The secret in a confirmable channel's link (decisions D31, D33): derived from its id with an
 * instance key, so only messages carry it and nothing is stored. The link confirms the channel,
 * refuses it, and later turns it off.
 */
export interface ChannelLinks {
  tokenFor(channelId: string): string;
  /** The channel a token was made for, or undefined for a made-up one. */
  channelOf(token: string): string | undefined;
  /**
   * The same for Telegram's Start parameter, which allows only 64 characters (decision D34):
   * shorter, but just as unguessable.
   */
  startTokenFor(channelId: string): string;
  channelOfStart(token: string): string | undefined;
}

/** What a channel is for: a plan (as host or responder), or the account itself. */
export type ChannelSubject = { kind: "plan"; planTitle: string } | { kind: "account" };

/** A channel as an outbox writes to it: where, its language, and its id for the channel's link. */
interface RecipientBase {
  channelId: string;
  language: string;
}
export interface EmailRecipient extends RecipientBase {
  kind: "email";
  address: string;
}
export interface NtfyRecipient extends RecipientBase {
  kind: "ntfy";
  topic: string;
}
export interface TelegramRecipient extends RecipientBase {
  kind: "telegram";
  chatId: string;
}
export type ChannelRecipient = EmailRecipient | NtfyRecipient | TelegramRecipient;

/** The messages every confirmable channel gets besides notifications (decisions D31, D33). */
export interface ChannelOutbox<R extends ChannelRecipient> {
  /** The link that confirms the channel, before anything else is sent to it. */
  confirmation(to: R, about: ChannelSubject): Promise<SendResult>;
  /** An unused account is deleted on this date unless used before (spec 3.10, decision I52). */
  accountExpiry(to: R, deleteAt: Date): Promise<SendResult>;
}

/** Emails that are not notifications (decision D31). */
export interface EmailOutbox extends ChannelOutbox<EmailRecipient> {
  /** Tells CONTACT_EMAIL that a report came in, without its content (spec 7 Moderation). */
  reportAlert(): Promise<SendResult>;
  /** "Email me my links": the item's new link, which replaces the old one (decision D31). */
  newLink(to: EmailRecipient, link: { title: string; url: string }): Promise<SendResult>;
}

export type NtfyOutbox = ChannelOutbox<NtfyRecipient>;

/** Telegram's confirmation is the bot's answer to Start: notifications are on (decision D34). */
export type TelegramOutbox = ChannelOutbox<TelegramRecipient>;

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
