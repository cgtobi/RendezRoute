// Spec 2b privacy tests: sentinel values must be absent from every response an audience
// may not see. Extended by every later step that adds an endpoint or audience.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { checkpoint } from "../../src/adapters/out/sqlite/database.ts";
import { createTestApp } from "../support/app.ts";
import { TestClient } from "../support/client.ts";
import { createPlanViaUi } from "../support/plans.ts";

const SENTINEL_DESCRIPTION = "SENTINEL-exact-start-7c1e";
const SENTINEL_LAT = "48.16321";
const SENTINEL_LNG = "11.60147";
const exactStart = {
  exactDescription: SENTINEL_DESCRIPTION,
  exactLat: SENTINEL_LAT,
  exactLng: SENTINEL_LNG,
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function expectNoExactStart(body: string) {
  expect(body).not.toContain(SENTINEL_DESCRIPTION);
  expect(body).not.toContain(SENTINEL_LAT);
  expect(body).not.toContain(SENTINEL_LNG);
}

describe("exact start per audience (spec 3.6)", () => {
  it("is absent for viewers on every plan endpoint", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host, exactStart);
    const viewer = new TestClient(app);
    for (const path of [`/p/${planId}`, hostPath, "/a/unknown-token-unknown-token-unknown-tok"]) {
      expectNoExactStart(await (await viewer.get(path)).text());
    }
  });

  it("is absent for a link-preview fetcher that opens the host link and follows to the plan (decision D1)", async () => {
    const { app } = await createTestApp();
    const { planId, hostPath } = await createPlanViaUi(new TestClient(app), exactStart);
    const fetcher = new TestClient(app);
    expectNoExactStart(await (await fetcher.get(hostPath)).text());
    expectNoExactStart(await (await fetcher.get(`/p/${planId}`)).text());
  });

  it("is present for the host", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host, exactStart);
    expect(await (await host.get(`/p/${planId}`)).text()).toContain(SENTINEL_DESCRIPTION);
  });
});

describe("host link (spec 3.2: shown once on creation)", () => {
  it("appears on no page after the links page, not even for the host", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host, exactStart);
    const token = hostPath.slice("/a/".length);
    for (const path of [`/p/${planId}`, "/new", "/"]) {
      expect(await (await host.get(path)).text()).not.toContain(token);
    }
  });
});

describe("data at rest (spec 2b)", () => {
  it("keeps encrypted fields and tokens out of the database and WAL files in plaintext", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-privacy-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");
    const { app, database } = await createTestApp({ databasePath: path });
    const host = new TestClient(app);
    const { hostPath } = await createPlanViaUi(host, exactStart);
    const hostToken = hostPath.slice("/a/".length);
    const deviceToken = host.cookies.get("__Host-rr-device") ?? "";
    expect(deviceToken).toHaveLength(43);

    const raw = () =>
      [path, `${path}-wal`]
        .filter(existsSync)
        .map((file) => readFileSync(file).toString("latin1"))
        .join("");
    for (const content of [raw(), (checkpoint(database), raw())]) {
      expect(content).not.toContain(SENTINEL_DESCRIPTION);
      expect(content).not.toContain(SENTINEL_LAT);
      expect(content).not.toContain(hostToken);
      expect(content).not.toContain(deviceToken);
    }
    await database.close();
  });
});

describe("logs (spec 2b: never tokens, names or exact coordinates)", () => {
  it("contain no tokens, names or exact start through a full create-view-link flow", async () => {
    const { app, logs } = await createTestApp();
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host, {
      ...exactStart,
      posterName: "SENTINEL-name",
    });
    const other = new TestClient(app);
    await other.postForm("/a", await other.hiddenFields(hostPath));
    await other.get(`/p/${planId}`);

    const output = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    expect(output).not.toContain(hostPath.slice(3));
    expect(output).not.toContain("SENTINEL");
    expect(output).not.toContain(SENTINEL_LAT);
    expect(output).not.toContain(host.cookies.get("__Host-rr-device") ?? "never");
  });
});
