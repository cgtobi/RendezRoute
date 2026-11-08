// Caches of public data from external services expire after at most 7 days (spec 3.10).
// Also stated in the privacy notice.
export const SERVICE_CACHE_DAYS = 7;
export const SERVICE_CACHE_MS = SERVICE_CACHE_DAYS * 24 * 60 * 60 * 1000;
