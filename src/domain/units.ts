// Metric or imperial, chosen per viewer (spec 2 i18n, decision P5). Storage is always metric:
// meters and seconds per km; imperial values are converted on entry and display.
export type Units = "metric" | "imperial";

export const UNITS: readonly Units[] = ["metric", "imperial"];
export const KM_PER_MILE = 1.609344;
const METERS_PER_FOOT = 0.3048;

export function isUnits(value: unknown): value is Units {
  return value === "metric" || value === "imperial";
}

/** Kilometers or miles to meters. */
export function distanceToMeters(value: number, units: Units): number {
  return value * (units === "imperial" ? KM_PER_MILE : 1) * 1000;
}

/** Meters to kilometers or miles. */
export function metersToDistance(meters: number, units: Units): number {
  return meters / 1000 / (units === "imperial" ? KM_PER_MILE : 1);
}

/** Meters or feet to meters. */
export function elevationToMeters(value: number, units: Units): number {
  return units === "imperial" ? value * METERS_PER_FOOT : value;
}

/** Meters to meters or feet. */
export function metersToElevation(meters: number, units: Units): number {
  return units === "imperial" ? meters / METERS_PER_FOOT : meters;
}

/** Degrees Celsius to Celsius or Fahrenheit. */
export function celsiusToTemperature(celsius: number, units: Units): number {
  return units === "imperial" ? (celsius * 9) / 5 + 32 : celsius;
}

/** Kilometers per hour to km/h or mph. */
export function kmhToSpeed(kmh: number, units: Units): number {
  return units === "imperial" ? kmh / KM_PER_MILE : kmh;
}
