import { describe, expect, it } from "vite-plus/test";
import {
  checkSupervisorVersion,
  MINIMUM_SUPERVISOR_VERSION,
} from "../../src/application/supervisor-version.ts";
import type { SupervisorInfo } from "../../src/application/ports.ts";

const reports = (version: string): SupervisorInfo => ({ version: () => Promise.resolve(version) });
const refuses = (message: string): SupervisorInfo => ({
  version: () => Promise.reject(new Error(message)),
});

describe("the Supervisor version check (decision D56)", () => {
  it("names the minimum", () => {
    expect(MINIMUM_SUPERVISOR_VERSION).toBe("2026.10.4");
  });

  it("accepts the minimum and anything newer, compared by number", async () => {
    for (const version of [
      "2026.10.4",
      "2026.10.5",
      "2026.10.12",
      "2026.11.0",
      "2027.1.0",
      "2026.12.1",
    ]) {
      expect([version, await checkSupervisorVersion(reports(version))]).toEqual([
        version,
        { ok: true, version },
      ]);
    }
  });

  it("refuses older versions, with the version found", async () => {
    for (const version of ["2026.10.3", "2026.9.9", "2025.12.0", "2026.10.0", "2026.2.30"]) {
      expect([version, await checkSupervisorVersion(reports(version))]).toEqual([
        version,
        {
          ok: false,
          message: `Ingress mode needs Home Assistant Supervisor 2026.10.4 or newer; found ${version}.`,
        },
      ]);
    }
  });

  it("counts a development build as before its release", async () => {
    expect((await checkSupervisorVersion(reports("2026.10.4.dev0"))).ok).toBe(false);
    expect((await checkSupervisorVersion(reports("2026.10.5.dev202610241200"))).ok).toBe(true);
    expect((await checkSupervisorVersion(reports("2026.11.0.dev1"))).ok).toBe(true);
  });

  it("refuses a version it cannot read, naming it", async () => {
    for (const version of [
      "dev",
      "",
      "latest",
      "2026.10",
      "2026.10.4.5",
      "v2026.10.4",
      "2026.10.x",
      "2026.13.0",
    ]) {
      expect([version, await checkSupervisorVersion(reports(version))]).toEqual([
        version,
        {
          ok: false,
          message: `Ingress mode needs Home Assistant Supervisor 2026.10.4 or newer; the Supervisor reports the version "${version.slice(0, 40)}", which cannot be compared.`,
        },
      ]);
    }
  });

  it("says so when the Supervisor cannot be asked", async () => {
    expect(await checkSupervisorVersion(refuses("connect ECONNREFUSED"))).toEqual({
      ok: false,
      message:
        "Ingress mode could not ask the Supervisor for its version (connect ECONNREFUSED). Set SUPERVISOR_URL and SUPERVISOR_TOKEN, or ADMIN_INGRESS_SKIP_VERSION_CHECK=true for development.",
    });
  });
});
