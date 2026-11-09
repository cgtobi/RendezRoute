// Columns that plans and templates store alike: colors, and the exact start encrypted as JSON
// (spec 3.11).
import type { EncryptedField, FieldCipher } from "../../../application/ports.ts";
import { type HexColor, parseHexColor } from "../../../domain/color.ts";
import type { ExactStart, GeoPoint } from "../../../domain/geo.ts";
import type { PaceBand } from "../../../domain/pace.ts";

export const iso = (date: Date) => date.toISOString();

function storedColor(value: string): HexColor {
  const parsed = parseHexColor(value);
  if (!parsed.ok) throw new Error("Stored color is not a valid #RRGGBB value.");
  return parsed.value;
}

export const colorsFrom = (row: { primary_color: string; secondary_color: string }) => ({
  primary: storedColor(row.primary_color),
  secondary: storedColor(row.secondary_color),
});

interface AreaColumns {
  area_label: string;
  area_lat: number | null;
  area_lng: number | null;
}

export const areaColumns = (area: { label: string; point: GeoPoint | undefined }): AreaColumns => ({
  area_label: area.label,
  area_lat: area.point?.lat ?? null,
  area_lng: area.point?.lng ?? null,
});

export const areaFrom = (row: AreaColumns) => ({
  label: row.area_label,
  point:
    row.area_lat === null || row.area_lng === null
      ? undefined
      : { lat: row.area_lat, lng: row.area_lng },
});

interface PaceColumns {
  pace_min_s_per_km: number | null;
  pace_max_s_per_km: number | null;
}

export const paceColumns = (pace: PaceBand | undefined): PaceColumns => ({
  pace_min_s_per_km: pace?.fastest ?? null,
  pace_max_s_per_km: pace?.slowest ?? null,
});

export const paceFrom = (row: PaceColumns): PaceBand | undefined =>
  row.pace_min_s_per_km === null || row.pace_max_s_per_km === null
    ? undefined
    : { fastest: row.pace_min_s_per_km, slowest: row.pace_max_s_per_km };

interface StoredExactStart {
  lat?: number;
  lng?: number;
  description?: string;
}

export function encryptExactStart(
  cipher: FieldCipher,
  exact: ExactStart | undefined,
  field: EncryptedField,
): string | null {
  if (exact === undefined) return null;
  const stored: StoredExactStart = {
    ...(exact.point === undefined ? {} : { lat: exact.point.lat, lng: exact.point.lng }),
    ...(exact.description === undefined ? {} : { description: exact.description }),
  };
  return cipher.encrypt(JSON.stringify(stored), field);
}

export function decryptExactStart(
  cipher: FieldCipher,
  value: string | null,
  field: EncryptedField,
): ExactStart | undefined {
  if (value === null) return undefined;
  const stored = JSON.parse(cipher.decrypt(value, field)) as StoredExactStart;
  return {
    point:
      stored.lat === undefined || stored.lng === undefined
        ? undefined
        : { lat: stored.lat, lng: stored.lng },
    description: stored.description,
  };
}
