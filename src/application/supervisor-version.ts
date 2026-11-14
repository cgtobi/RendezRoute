// The start-up check of Home Assistant Ingress mode (decision D56): older Supervisors let a
// logged-in client smuggle identity headers (the case-sensitive filter was fixed in 2026.10.3, the
// groups header that names administrators arrived in 2026.10.4), so the admin identity is trusted
// only from a Supervisor at least this new.
import type { SupervisorInfo } from "./ports.ts";

export const MINIMUM_SUPERVISOR_VERSION = "2026.10.4";

export type SupervisorCheck = { ok: true; version: string } | { ok: false; message: string };

/**
 * "2026.10.4" (year.month.patch). A development build "2026.10.5.dev0" counts as a pre-release:
 * newer than the previous release, older than its own. Anything else (including "dev") is unknown.
 */
function parseVersion(text: string): { parts: [number, number, number]; dev: boolean } | undefined {
  const match = /^(\d{4})\.(\d{1,2})\.(\d{1,4})(\.dev\d*)?$/.exec(text);
  if (match === null) return undefined;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  return { parts: [Number(match[1]), month, Number(match[3])], dev: match[4] !== undefined };
}

/** Negative when `a` is older than `b`; a side that cannot be read counts as older (fail closed). */
function compare(a: ReturnType<typeof parseVersion>, b: ReturnType<typeof parseVersion>): number {
  if (a === undefined || b === undefined) return -1;
  for (const [index, part] of a.parts.entries()) {
    const other = b.parts[index] ?? 0;
    if (part !== other) return part - other;
  }
  return Number(!a.dev) - Number(!b.dev);
}

export async function checkSupervisorVersion(supervisor: SupervisorInfo): Promise<SupervisorCheck> {
  const needs = `Ingress mode needs Home Assistant Supervisor ${MINIMUM_SUPERVISOR_VERSION} or newer`;
  let version: string;
  try {
    version = await supervisor.version();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false,
      message: `Ingress mode could not ask the Supervisor for its version (${reason}). Set SUPERVISOR_URL and SUPERVISOR_TOKEN, or ADMIN_INGRESS_SKIP_VERSION_CHECK=true for development.`,
    };
  }
  const found = parseVersion(version);
  if (found === undefined) {
    return {
      ok: false,
      message: `${needs}; the Supervisor reports the version "${version.slice(0, 40)}", which cannot be compared.`,
    };
  }
  if (compare(found, parseVersion(MINIMUM_SUPERVISOR_VERSION)) < 0) {
    return { ok: false, message: `${needs}; found ${version}.` };
  }
  return { ok: true, version };
}
