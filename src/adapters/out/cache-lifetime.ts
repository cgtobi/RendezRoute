// Caches of public data from external services expire after at most 7 days (spec 3.10).
// Also stated in the privacy notice.
export const SERVICE_CACHE_DAYS = 7;
export const SERVICE_CACHE_MS = SERVICE_CACHE_DAYS * 24 * 60 * 60 * 1000;

/** Weather forecasts are kept for an hour (decision I41); also stated in the privacy notice. */
export const WEATHER_CACHE_MINUTES = 60;
export const WEATHER_CACHE_MS = WEATHER_CACHE_MINUTES * 60 * 1000;
/** A weather failure is remembered this long, so an outage does not slow every plan page. */
export const WEATHER_FAILURE_CACHE_MS = 10 * 60 * 1000;
