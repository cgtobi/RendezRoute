// Pace is stored as whole seconds per km (spec 3.1). Runs are entered and shown as
// min:ss per km or mile; rides as whole km/h or mph (decision D3).
import { err, ok, type Result } from "./result.ts";
import { KM_PER_MILE, type Units } from "./units.ts";

export type { Units } from "./units.ts";

/** Accepted band in seconds per km: 60 km/h at the fast end, 30:00 min/km at the slow end (decision D6). */
export const PACE_LIMITS = { fastest: 60, slowest: 1800 } as const;

export interface PaceBand {
  /** Seconds per km at the fast end (smaller number). */
  fastest: number;
  /** Seconds per km at the slow end. */
  slowest: number;
}

export function parsePace(input: string, units: Units): Result<number, "pace_invalid"> {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(input.trim());
  if (match === null) return err("pace_invalid");
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  if (seconds <= 0) return err("pace_invalid");
  return ok(units === "imperial" ? Math.round(seconds / KM_PER_MILE) : seconds);
}

export function formatPace(secondsPerKm: number, units: Units): string {
  const seconds = units === "imperial" ? Math.round(secondsPerKm * KM_PER_MILE) : secondsPerKm;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Whole km/h or mph → seconds per km. Whole speeds survive the round trip (tested). */
export function paceFromSpeed(speed: number, units: Units): Result<number, "speed_invalid"> {
  if (!Number.isInteger(speed) || speed <= 0) return err("speed_invalid");
  const kmh = units === "imperial" ? speed * KM_PER_MILE : speed;
  return ok(Math.round(3600 / kmh));
}

export function formatSpeed(secondsPerKm: number, units: Units): string {
  const kmh = 3600 / secondsPerKm;
  return String(Math.round(units === "imperial" ? kmh / KM_PER_MILE : kmh));
}

export function validatePaceBand(
  band: PaceBand,
): Result<PaceBand, "pace_out_of_range" | "pace_band_reversed"> {
  const inRange = (value: number) =>
    Number.isInteger(value) && value >= PACE_LIMITS.fastest && value <= PACE_LIMITS.slowest;
  if (!inRange(band.fastest) || !inRange(band.slowest)) return err("pace_out_of_range");
  if (band.fastest > band.slowest) return err("pace_band_reversed");
  return ok(band);
}
