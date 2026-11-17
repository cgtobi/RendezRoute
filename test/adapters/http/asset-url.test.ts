// Versioned asset URLs (decision D82).
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { assetUrl, contentHash, currentVersion } from "../../../src/adapters/in/http/asset-url.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "assets-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("assetUrl", () => {
  it("adds ten hex characters of the SHA-256, stable for equal bytes", () => {
    writeFileSync(join(root, "a.css"), "body{}");
    writeFileSync(join(root, "b.css"), "body{}");
    const a = assetUrl("/", "a.css", root);
    expect(a).toMatch(/^\/static\/a\.css\?v=[0-9a-f]{10}$/);
    expect(a).toBe(assetUrl("/", "a.css", root));
    expect(a.split("?v=")[1]).toBe(assetUrl("/", "b.css", root).split("?v=")[1]);
    expect(contentHash(new TextEncoder().encode("body{}"))).toBe(a.split("?v=")[1]);
  });

  it("differs when the bytes differ and follows an edit (new modification time)", () => {
    const file = join(root, "a.css");
    writeFileSync(file, "one");
    utimesSync(file, 1000, 1000);
    const before = assetUrl("/", "a.css", root);
    writeFileSync(file, "two");
    utimesSync(file, 2000, 2000);
    expect(assetUrl("/", "a.css", root)).not.toBe(before);
  });

  it("keeps the path prefix and falls back to the plain URL for a missing file", () => {
    writeFileSync(join(root, "a.js"), "x");
    expect(assetUrl("/ingress/", "a.js", root)).toMatch(
      /^\/ingress\/static\/a\.js\?v=[0-9a-f]{10}$/,
    );
    expect(assetUrl("/ingress/", "missing.js", root)).toBe("/ingress/static/missing.js");
  });
});

describe("currentVersion", () => {
  it("is the hash of the file and undefined for a missing file or a path outside the root", () => {
    writeFileSync(join(root, "a.css"), "body{}");
    expect(currentVersion("a.css", root)).toBe(contentHash(new TextEncoder().encode("body{}")));
    expect(currentVersion("missing.css", root)).toBeUndefined();
    expect(currentVersion("../package.json", root)).toBeUndefined();
    expect(currentVersion("%2e%2e/package.json", root)).toBeUndefined();
    expect(currentVersion("", root)).toBeUndefined();
    expect(assetUrl("/", "../package.json", root)).toBe("/static/../package.json");
  });
});

describe("asset links in pages", () => {
  it("carry ?v= and the page's path base", async () => {
    const { app } = await createTestApp({
      env: { ADMIN_TOKEN: "admin-token-for-tests-0123456789abcdef" },
    });
    const home = await (await new TestClient(app).get("/")).text();
    const admin = await (await new TestClient(app).get("/admin/login")).text();
    expect(assetUrl("/", "app.css")).toMatch(/\?v=[0-9a-f]{10}$/);
    expect(home).toContain(`href="${assetUrl("/", "app.css")}"`);
    expect(admin).toContain(`href="${assetUrl("../", "app.css")}"`);
    expect(admin).toMatch(/href="\.\.\/static\/app\.css\?v=[0-9a-f]{10}"/);
  });
});
