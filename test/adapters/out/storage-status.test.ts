import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { createStorageStatus } from "../../../src/adapters/out/storage-status.ts";

describe("createStorageStatus", () => {
  it("reads free and total bytes of an existing directory", async () => {
    const sample = await createStorageStatus(tmpdir()).read();
    expect(sample?.totalBytes).toBeGreaterThan(0);
    expect(sample?.freeBytes).toBeGreaterThanOrEqual(0);
    expect(sample?.freeBytes).toBeLessThanOrEqual(sample?.totalBytes ?? 0);
  });

  it("fails for a directory that is not there, which the guard treats as ok", async () => {
    const gone = join(mkdtempSync(join(tmpdir(), "rendezroute-storage-")), "missing");
    await expect(createStorageStatus(gone).read()).rejects.toThrow(/ENOENT/);
    rmSync(join(gone, ".."), { recursive: true });
  });
});
