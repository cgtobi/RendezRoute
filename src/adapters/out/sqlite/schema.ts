// Table types for Kysely (spec section 4). Must match the migrations in ./migrations;
// repository integration tests and the schema conformance test catch drift.
import type { ActivityType } from "../../../domain/activity.ts";
import type { DropPolicy, JoinMode, PlanStatus, Visibility } from "../../../domain/plan.ts";
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
}

export interface DeviceLinksTable {
  device_id: string;
  role: "host" | "manage";
  plan_id: string | null;
  response_id: string | null;
  created_at: string;
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

export interface DatabaseSchema {
  /** Instance-level values, e.g. the encryption key fingerprint (spec 3.11). */
  instance_meta: InstanceMetaTable;
  plans: PlansTable;
  devices: DevicesTable;
  device_links: DeviceLinksTable;
  plan_creation_nonces: PlanCreationNoncesTable;
  responses: ResponsesTable;
}
