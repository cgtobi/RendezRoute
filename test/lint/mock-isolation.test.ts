// vite.config.ts runs the suite with `isolate: false`, so a worker's module cache survives between
// test files. A file that mocks a module and then imports the code under test gets the cached,
// unmocked copy whenever an earlier file in the same worker loaded it, and the mock silently never
// applies (flaky on CI, where the file-to-worker assignment differs). Every test file that calls
// the module mock must therefore also reset the module registry before importing.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const testRoot = resolve(import.meta.dirname, "..");
const self = resolve(import.meta.filename);

const MOCK_CALL = /\bvi\.mock\(/;
const RESET_CALL = /\bvi\.resetModules\(\)/;

function testFiles(): string[] {
  return readdirSync(testRoot, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => join(testRoot, path))
    .filter((path) => path !== self);
}

describe("module mocks under isolate: false", () => {
  it("every test file that calls vi.mock also calls vi.resetModules", () => {
    const offenders = testFiles()
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return MOCK_CALL.test(source) && !RESET_CALL.test(source);
      })
      .map((path) => relative(testRoot, path));
    if (offenders.length > 0) {
      throw new Error(
        "vite.config.ts sets isolate: false, so the worker's module cache is shared between test " +
          "files and a cached unmocked copy of the module under test can be reused. Call " +
          "vi.resetModules() before importing the code under test (and again in afterAll). " +
          `Offending files: ${offenders.join(", ")}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("detects a mock without a reset", () => {
    expect(MOCK_CALL.test('vi.mock(import("./a.ts"));')).toBe(true);
    expect(RESET_CALL.test("vi.resetModules();")).toBe(true);
    expect(RESET_CALL.test('vi.mock("x")')).toBe(false);
  });
});
