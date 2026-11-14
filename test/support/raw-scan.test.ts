import { describe, expect, it, vi } from "vite-plus/test";
import { createLogger } from "../../src/adapters/logging.ts";
import { hasStandalone } from "./raw-scan.ts";

describe("raw file scan with short rounded coordinates", () => {
  it("shows the plain substring check collides with wall-clock timestamps", () => {
    const raw = "0031-contribution-notes2026-11-14T20:45:48.126Z0032-x2026-11-14T20:45:11.567Z";
    expect(raw).toContain("48.12");
    expect(raw).toContain("11.56");
  });

  it("ignores timestamps but still finds standalone rounded points", () => {
    const stamps = "notes2026-11-14T20:45:48.126Z and 2026-11-14T20:45:11.567Z";
    expect(hasStandalone(stamps, "48.12")).toBe(false);
    expect(hasStandalone(stamps, "11.56")).toBe(false);
    for (const leak of ["lat=48.12 lng=11.56", "48.12,11.56", '"48.12"', "[48.12]", "48.12"]) {
      expect(hasStandalone(leak, "48.12")).toBe(true);
    }
    expect(hasStandalone("lat=48.12 lng=11.56", "11.56")).toBe(true);
  });
});

describe("log lines in the logger's own format", () => {
  const logLine = (time: string, fields: Record<string, unknown> = {}) =>
    JSON.stringify({ time, level: "info", event: "request", ...fields });

  it("ignores the logger timestamp but still flags leaked rounded points", () => {
    const lines = [
      logLine("2026-11-14T20:45:48.126Z"),
      logLine("2026-11-14T20:45:11.567Z"),
      logLine("2026-11-14T20:45:48.120Z"),
      logLine("2026-11-14T20:45:11.560Z"),
    ].join("\n");
    // The old plain check collides with the timestamps; the boundary-aware one does not.
    expect(lines).toContain("48.12");
    expect(lines).toContain("11.56");
    expect(hasStandalone(lines, "48.12")).toBe(false);
    expect(hasStandalone(lines, "11.56")).toBe(false);
    expect(hasStandalone('{"lat":48.12,"lng":11.56}', "48.12")).toBe(true);
    expect(hasStandalone('{"lat":48.12,"lng":11.56}', "11.56")).toBe(true);
    expect(hasStandalone('{"lat":"48.12","lng":"11.56"}', "48.12")).toBe(true);
    expect(hasStandalone('"48.12"', "48.12")).toBe(true);
    expect(hasStandalone("48.12,", "48.12")).toBe(true);
    expect(hasStandalone(logLine("2026-11-14T20:45:48.126Z", { lat: 48.12 }), "48.12")).toBe(true);
  });

  it("proves the flake deterministically with the logger itself", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-14T20:45:48.126Z"));
      const written: string[] = [];
      createLogger({ write: (line) => written.push(line) }).info("request");
      const logs = written.join("\n");
      expect(logs).toContain('"time":"2026-11-14T20:45:48.126Z"');
      expect(logs.includes("48.12")).toBe(true); // old check: would fail the privacy test
      expect(hasStandalone(logs, "48.12")).toBe(false); // new check passes
    } finally {
      vi.useRealTimers();
    }
  });
});
