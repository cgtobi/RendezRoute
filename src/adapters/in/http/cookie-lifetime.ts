// Lifetime of the long-lived cookies (device, language, units; spec 3.2, decisions P5, D15).
// Also stated in the privacy notice.
export const LONG_COOKIE_DAYS = 400;
export const LONG_COOKIE_SECONDS = LONG_COOKIE_DAYS * 24 * 60 * 60;
