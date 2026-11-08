// Time zones in the browser (decision P6): the server cannot know the viewer's or poster's zone.
// No DOM access here, so the logic is testable in Node; zone-fields.ts applies it to the page.

/** The viewer's IANA zone, if the browser reports one. */
export function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** The zone to preselect on the create form, or undefined to leave the select alone. */
export function detectedZone(options: {
  offered: readonly string[];
  current: string;
  fallback: string;
  browser: string | undefined;
}): string | undefined {
  const { offered, current, fallback, browser } = options;
  if (browser === undefined || current !== fallback || browser === current) return undefined;
  return offered.includes(browser) ? browser : undefined;
}
