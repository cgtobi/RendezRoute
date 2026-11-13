// Table types for Kysely (spec section 4). Must match the migrations in ./migrations;
// repository integration tests and the schema conformance test catch drift.
import type { Audience } from "../../../application/ports.ts";
import type { IdentityProviderKind } from "../../../domain/identity.ts";
import type { ReportReason } from "../../../domain/report.ts";
import type { RatingValue } from "../../../domain/rating.ts";
import type { Generated } from "kysely";
import type { ActivityType } from "../../../domain/activity.ts";
import type { JobType } from "../../../domain/jobs.ts";
import type { DropPolicy, JoinMode, PlanStatus, Visibility } from "../../../domain/plan.ts";
import type { ReminderKind } from "../../../domain/reminders.ts";
import type { ResponseKind } from "../../../domain/response.ts";
import type { RecapWindow } from "../../../domain/schedule.ts";

export interface InstanceMetaTable {
  key: string;
  value: string;
}

export interface PlansTable {
  id: string;
  slug: string | null;
  poster_name: string;
  poster_language: string;
  activity_type: ActivityType;
  title: string;
  note: string | null;
  starts_at: string;
  timezone: string;
  area_label: string;
  area_lat: number | null;
  area_lng: number | null;
  exact_location_enc: string | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  pace_min_s_per_km: number | null;
  pace_max_s_per_km: number | null;
  drop_policy: DropPolicy;
  /** Comma-separated, in their order (decision D41). */
  share_buttons: string;
  primary_color: string;
  secondary_color: string;
  visibility: Visibility;
  join_mode: JoinMode;
  status: PlanStatus;
  recap_window: RecapWindow;
  recap_window_set_at: string | null;
  recap_closed_at: string | null;
  federated_at: string | null;
  ratings_closed_at: string | null;
  rating_tally: string | null;
  retention_days: number;
  delete_at: string;
  keep_as_template: number;
  template_include_private: number;
  host_token_hash: string;
  owner_identity_id: Generated<string | null>;
  created_at: string;
  updated_at: string;
}

export interface DevicesTable {
  id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  identity_id: Generated<string | null>;
}

export interface DeviceLinksTable {
  device_id: string;
  role: "host" | "manage" | "template";
  plan_id: string | null;
  response_id: string | null;
  template_id: string | null;
  created_at: string;
}

export type DeviceAccessView = Omit<DeviceLinksTable, "created_at"> & {
  source: "link" | "account";
};

export interface PlanTemplatesTable {
  id: string;
  host_token_hash: string | null;
  owner_identity_id: Generated<string | null>;
  poster_name: string;
  poster_language: string;
  timezone: string;
  start_time: string;
  activity_type: ActivityType;
  title: string;
  note: string | null;
  area_label: string;
  area_lat: number | null;
  area_lng: number | null;
  exact_location_enc: string | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  pace_min_s_per_km: number | null;
  pace_max_s_per_km: number | null;
  drop_policy: DropPolicy;
  /** Comma-separated, in their order (decision D41). */
  share_buttons: string;
  primary_color: string;
  secondary_color: string;
  visibility: Visibility;
  join_mode: JoinMode;
  recap_window: RecapWindow;
  retention_days: number;
  route_geojson_enc: string | null;
  creation_nonce: string | null;
  last_used_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface ResponsesTable {
  id: string;
  plan_id: string;
  identity_id: Generated<string | null>;
  kind: ResponseKind;
  display_name_enc: string;
  request_note_enc: string | null;
  manage_token_hash: string;
  device_id: string | null;
  language: string;
  previous_kind: ResponseKind | null;
  creation_nonce: string | null;
  /** Remote participants (decision D42): keyed hash of the actor identifier; null for web responses. */
  remote_actor_hmac: Generated<string | null>;
  /** Remote participants: the actor's identifier, address and inboxes, encrypted (migration 0029). */
  remote_actor_enc: Generated<string | null>;
  created_at: string;
  updated_at: string;
}

export interface PlanCreationNoncesTable {
  nonce: string;
  plan_id: string;
  created_at: string;
}

export interface RoutesTable {
  id: string;
  plan_id: string;
  geojson_enc: string;
}

export interface PlanPreviewsTable {
  plan_id: string;
  version: string;
  image: Uint8Array;
}

export interface JobQueueTable {
  id: string;
  type: JobType;
  payload_enc: string;
  plan_id: string | null;
  response_id: string | null;
  run_at: string;
  expires_at: string | null;
  attempts: Generated<number>;
  last_error: string | null;
}

export interface NotificationChannelsTable {
  id: string;
  response_id: string | null;
  plan_id: string | null;
  /** An account's own channel (spec 4), from v1.0 step 6b. */
  identity_id: Generated<string | null>;
  kind: "webpush" | "email" | "ntfy" | "telegram" | "fediverse_dm";
  config_enc: string;
  verified: Generated<number>;
  created_at: string;
  device_id: Generated<string | null>;
}

export interface SentRemindersTable {
  plan_id: string;
  response_id: string | null;
  kind: ReminderKind;
  due_at: string;
}

export interface CalendarFeedsTable {
  id: string;
  device_id: string;
  token_hash: string;
  language: string;
  created_at: string;
}

export interface RecapContributionsTable {
  id: string;
  plan_id: string;
  response_id: string | null;
  body_enc: string | null;
  link_url_enc: string | null;
  hidden_by_poster: number;
  created_at: string;
  updated_at: string;
}

export interface FedifyKvTable {
  /** The key as a JSON array of strings. */
  key: string;
  /** JSON. */
  value: string;
  expires_at: string | null;
}

export interface FediverseProfilesTable {
  id: string;
  identity_id: string | null;
  handle: string | null;
  handle_hmac: string;
  keys_enc: string | null;
  created_at: string;
  retired_at: string | null;
}

export interface FediverseFollowersTable {
  id: string;
  /** The followed actor's identifier: "instance" or a poster actor's. */
  local_actor: string;
  remote_hmac: string;
  remote_enc: string;
  created_at: string;
}

export interface PlanPublicationsTable {
  plan_id: string;
  /** Who sent it, while it is in the fediverse; null once withdrawn. */
  local_actor: string | null;
  audience: Audience | null;
  published_at: string;
  withdrawn_at: string | null;
}

/** Private direct Notes to accepted remote participants (decision D43, migration 0030). */
export interface ParticipantNotesTable {
  /** The remote participant's response: one Note per response. */
  response_id: string;
  plan_id: string;
  /** Random id in the Note's URI. */
  note_id: string;
  /** Who sent it: "instance" or a poster actor's identifier; sends its Updates and Delete too. */
  local_actor: string;
  /** Keyed hash of the secret GPX URL token; null when the plan has no route. */
  route_token_hmac: string | null;
  /** The token itself, encrypted (participant_notes.route_token); null exactly with the hash. */
  route_token_enc: string | null;
  /** Keyed hash of the exact start, route, time and language last sent. */
  content_hash: string;
  sent_at: string;
  updated_at: string;
}

export interface DatabaseSchema {
  /** Instance-level values, e.g. the encryption key fingerprint (spec 3.11). */
  instance_meta: InstanceMetaTable;
  /** Fedify's federation state (spec 4, plan v1.0 step 9a). */
  fedify_kv: FedifyKvTable;
  /** Poster actors (decisions D36, D37). */
  fediverse_profiles: FediverseProfilesTable;
  fediverse_followers: FediverseFollowersTable;
  plan_publications: PlanPublicationsTable;
  /** Private Notes to accepted remote participants (decision D43). */
  participant_notes: ParticipantNotesTable;
  plans: PlansTable;
  devices: DevicesTable;
  device_links: DeviceLinksTable;
  /** View: a device's own links and everything its account owns (migration 0019). */
  device_access: DeviceAccessView;
  plan_creation_nonces: PlanCreationNoncesTable;
  responses: ResponsesTable;
  routes: RoutesTable;
  plan_previews: PlanPreviewsTable;
  job_queue: JobQueueTable;
  notification_channels: NotificationChannelsTable;
  sent_reminders: SentRemindersTable;
  calendar_feeds: CalendarFeedsTable;
  recap_contributions: RecapContributionsTable;
  plan_templates: PlanTemplatesTable;
  used_form_nonces: UsedFormNoncesTable;
  plan_ratings: PlanRatingsTable;
  reports: ReportsTable;
  invites: InvitesTable;
  permissions: PermissionsTable;
  identities: IdentitiesTable;
  pending_logins: PendingLoginsTable;
}

export interface PlanRatingsTable {
  id: string;
  plan_id: string;
  response_id: string;
  value: RatingValue;
  note_enc: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportsTable {
  id: string;
  plan_id: string;
  reason: ReportReason;
  details_enc: string | null;
  attached_content_enc: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface InvitesTable {
  id: string;
  token_hash: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: Generated<number>;
  revoked_at: string | null;
  created_at: string;
}

export interface IdentitiesTable {
  id: string;
  provider: IdentityProviderKind;
  subject_hmac: string;
  subject_enc: string;
  display_name_enc: string | null;
  handle_enc: string | null;
  created_at: string;
  last_active_at: string;
  /** The last expiry warning (decision I52); one per stretch of non-use. */
  expiry_warned_at: Generated<string | null>;
}

export interface PendingLoginsTable {
  state_hash: string;
  provider: IdentityProviderKind;
  secrets_enc: string;
  started_at: string;
}

export interface PermissionsTable {
  id: string;
  device_id: string | null;
  identity_id: string | null;
  permission: "may_post";
  invite_id: string | null;
  created_at: string;
}

export interface UsedFormNoncesTable {
  nonce: string;
  used_at: string;
}
