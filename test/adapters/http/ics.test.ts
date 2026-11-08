import { describe, expect, it } from "vite-plus/test";
import { writeCalendar } from "../../../src/adapters/in/http/ics.ts";

const now = new Date("2026-06-01T08:00:00Z");
const lines = (text: string) => text.split("\r\n");
const unfold = (text: string) => text.replaceAll("\r\n ", "");

describe("writeCalendar (RFC 5545)", () => {
  it("writes a calendar with timed and all-day events, lines ending in CRLF", () => {
    const text = writeCalendar({
      name: "RendezRoute",
      refreshHours: 1,
      now,
      events: [
        {
          uid: "abc@example.org",
          start: new Date("2026-06-07T05:30:00Z"),
          end: new Date("2026-06-07T06:45:00Z"),
          summary: "Run",
          location: "Park",
          description: "Line one\nLine two",
          url: "https://example.org/p/abc",
          status: "CANCELLED",
          geo: { lat: 48.1, lng: 11.6 },
        },
        {
          uid: "abc-deletion@example.org",
          start: { date: "2026-06-21" },
          end: { date: "2026-06-22" },
          summary: "Deleted",
          transparent: true,
        },
      ],
    });
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.replaceAll("\r\n", "")).not.toContain("\n");
    expect(lines(text)).toEqual(
      expect.arrayContaining([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//RendezRoute//RendezRoute//EN",
        "X-WR-CALNAME:RendezRoute",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
        "UID:abc@example.org",
        "DTSTAMP:20260601T080000Z",
        "DTSTART:20260607T053000Z",
        "DTEND:20260607T064500Z",
        "SUMMARY:Run",
        "LOCATION:Park",
        "DESCRIPTION:Line one\\nLine two",
        "URL:https://example.org/p/abc",
        "STATUS:CANCELLED",
        "GEO:48.1;11.6",
        "DTSTART;VALUE=DATE:20260621",
        "DTEND;VALUE=DATE:20260622",
        "TRANSP:TRANSPARENT",
      ]),
    );
  });

  it("escapes text values", () => {
    const text = writeCalendar({
      now,
      events: [{ uid: "u", start: now, end: now, summary: "a;b,c\\d\r\ne\u0007f" }],
    });
    expect(lines(text)).toContain("SUMMARY:a\\;b\\,c\\\\d\\ne f");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const summary = "Über den Berg ".repeat(20);
    const text = writeCalendar({ now, events: [{ uid: "u", start: now, end: now, summary }] });
    for (const line of lines(text)) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(unfold(text)).toContain(`SUMMARY:${summary}`);
  });
});
