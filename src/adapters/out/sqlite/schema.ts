// Table types for Kysely (spec section 4). Must match the migrations in ./migrations;
// repository integration tests and the schema conformance test catch drift.
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
  primary_color: string;
  secondary_color: string;
  visibility: Visibility;
  join_mode: JoinMode;
  status: PlanStatus;
  recap_window: RecapWindow;
  recap_window_set_at: string | null;
  recap_closed_at: string | null;
  ratings_closed_at: string | null;
  rating_tally: string | null;
  retention_days: number;
  delete_at: string;
  keep_as_template: number;
  template_include_private: number;
  host_token_hash: string;
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

export interface PlanTemplatesTable {
  id: string;
  host_token_hash: string | null;
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
  kind: ResponseKind;
  display_name_enc: string;
  request_note_enc: string | null;
  manage_token_hash: string;
  device_id: string | null;
  language: string;
  previous_kind: ResponseKind | null;
  creation_nonce: string | null;
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
  kind: "webpush";
  config_enc: string;
  verified: Generated<number>;
  created_at: string;
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

export interface DatabaseSchema {
  /** Instance-level values, e.g. the encryption key fingerprint (spec 3.11). */
  instance_meta: InstanceMetaTable;
  plans: PlansTable;
  devices: DevicesTable;
  device_links: DeviceLinksTable;
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
