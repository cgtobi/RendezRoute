// main.ts tells the federation inbox whether Flags may become reports: with any admin, Home
// Assistant Ingress included (decision D56), not only with ADMIN_TOKEN. The real startServer runs;
// only the federation factory is observed.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const seen = vi.hoisted(() => ({ reporting: [] as boolean[] }));
vi.mock(import("../src/adapters/in/activitypub/federation.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createInstanceFederation: (deps: Parameters<typeof actual.createInstanceFederation>[0]) => {
      seen.reporting.push(deps.reporting);
      return actual.createInstanceFederation(deps);
    },
  };
});

const { startServer } = await import("../src/main.ts");

const dirs: string[] = [];
afterEach(() => {
  seen.reporting.length = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function reportingFor(extra: Record<string, string>): Promise<boolean[]> {
  const dataDir = mkdtempSync(join(tmpdir(), "rendezroute-reporting-"));
  dirs.push(dataDir);
  const result = await startServer(
    {
      BASE_URL: "https://runs.example.org",
      CONTACT_EMAIL: "owner@example.org",
      DATA_DIR: dataDir,
      ...extra,
    },
    { port: 0, hostname: "127.0.0.1" },
  );
  if (!result.ok) throw new Error(result.errors.join("; "));
  await result.server.close();
  return [...seen.reporting];
}

describe("reporting of fediverse Flags", () => {
  it("is on in Ingress mode: an admin exists, though there is no ADMIN_TOKEN", async () => {
    expect(
      await reportingFor({
        ADMIN_INGRESS: "true",
        ADMIN_PORT: String(await freePort()),
        ADMIN_BIND: "127.0.0.1",
        ADMIN_INGRESS_SKIP_VERSION_CHECK: "true",
      }),
    ).toEqual([true]);
  });

  it("is off without any admin", async () => {
    expect(await reportingFor({})).toEqual([false]);
  });
});
