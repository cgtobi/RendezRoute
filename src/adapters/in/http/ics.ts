// iCalendar files (RFC 5545) for the calendar download and feed (spec 6 feature 2).

export interface IcsEvent {
  uid: string;
  /** An instant (written in UTC) or a whole local day. */
  start: Date | { date: string };
  end: Date | { date: string };
  summary: string;
  location?: string | undefined;
  description?: string | undefined;
  url?: string | undefined;
  status?: "CONFIRMED" | "CANCELLED" | undefined;
  geo?: { lat: number; lng: number } | undefined;
  /** Shown as free time. */
  transparent?: boolean | undefined;
}

const MAX_LINE_OCTETS = 75;

export function writeCalendar(calendar: {
  /** Shown by calendar apps as the subscription's name. */
  name?: string | undefined;
  /** How often subscribers should fetch the feed again. */
  refreshHours?: number | undefined;
  now: Date;
  events: readonly IcsEvent[];
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RendezRoute//RendezRoute//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (calendar.name !== undefined) lines.push(`X-WR-CALNAME:${text(calendar.name)}`);
  if (calendar.refreshHours !== undefined) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${calendar.refreshHours}H`);
    lines.push(`X-PUBLISHED-TTL:PT${calendar.refreshHours}H`);
  }
  for (const event of calendar.events) lines.push(...eventLines(event, calendar.now));
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

function eventLines(event: IcsEvent, now: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${text(event.uid)}`,
    `DTSTAMP:${instant(now)}`,
    moment("DTSTART", event.start),
    moment("DTEND", event.end),
    `SUMMARY:${text(event.summary)}`,
  ];
  if (event.location !== undefined) lines.push(`LOCATION:${text(event.location)}`);
  if (event.description !== undefined) lines.push(`DESCRIPTION:${text(event.description)}`);
  if (event.url !== undefined) lines.push(`URL:${event.url}`);
  if (event.status !== undefined) lines.push(`STATUS:${event.status}`);
  if (event.geo !== undefined) lines.push(`GEO:${event.geo.lat};${event.geo.lng}`);
  if (event.transparent === true) lines.push("TRANSP:TRANSPARENT");
  lines.push("END:VEVENT");
  return lines;
}

const moment = (name: string, value: Date | { date: string }) =>
  value instanceof Date
    ? `${name}:${instant(value)}`
    : `${name};VALUE=DATE:${value.date.replaceAll("-", "")}`;

/** 20260607T053000Z */
const instant = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** TEXT value escaping; other control characters become spaces. */
function text(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\p{Cc}/gu, " ");
}

/** Splits a line into 75-octet pieces, continued with a leading space, never inside a character. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const pieces: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = pieces.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      pieces.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  pieces.push(current);
  return pieces.join("\r\n ");
}
