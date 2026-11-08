// Guards the project's lint rules against silent breakage. oxlint's JS plugin
// support is alpha, and its pattern semantics differ subtly from ESLint, so these
// tests run the real `vp lint` with the repository's vite.config.ts against
// generated files and assert every violation is reported.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(import.meta.dirname, "../..");
const workDirs: string[] = [];

interface Diagnostic {
  file: string;
  rule: string;
  line: number;
}

function lint(files: Record<string, string>): Diagnostic[] {
  const dir = mkdtempSync(join(tmpdir(), "rendezroute-lint-"));
  workDirs.push(dir);

  // `vp` requires a package; re-export the real config so the guard tests exactly what `vp lint` applies.
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "lint-guard", private: true, type: "module" }),
  );
  writeFileSync(
    join(dir, "vite.config.ts"),
    `export { default } from ${JSON.stringify(join(repoRoot, "vite.config.ts"))};\n`,
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "react-jsx", jsxImportSource: "hono/jsx", strict: true },
    }),
  );

  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  let stdout: string;
  try {
    stdout = execFileSync(join(repoRoot, "node_modules/.bin/vp"), ["lint", "--format=json", "."], {
      cwd: dir,
      encoding: "utf8",
    });
  } catch (error) {
    // The linter exits non-zero when it finds errors; the report is still on stdout.
    stdout = (error as { stdout: string }).stdout;
  }

  const report = JSON.parse(stdout) as {
    diagnostics: { filename: string; code: string; labels: { span: { line: number } }[] }[];
  };
  return report.diagnostics.map((d) => ({
    file: d.filename,
    rule: d.code,
    line: d.labels[0]?.span.line ?? 0,
  }));
}

function linesFor(diagnostics: Diagnostic[], file: string, rule: string): number[] {
  return diagnostics
    .filter((d) => d.file === file && d.rule === rule)
    .map((d) => d.line)
    .sort((a, b) => a - b);
}

afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

describe("no inline styles or scripts (spec 3.8)", () => {
  const rule = "rendezroute(no-inline-style-script)";

  it("reports style attributes, <style>, inline <script> and dangerouslySetInnerHTML", () => {
    const file = "src/adapters/in/http/page.tsx";
    const diagnostics = lint({
      [file]: [
        'export const A = () => <div style="color:red" />;',
        'export const B = () => <style>{"a{}"}</style>;',
        'export const C = () => <script>{"alert(1)"}</script>;',
        'export const D = () => <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />;',
        'export const E = () => <script src="/static/app.js" />;',
        'export const F = () => <script src="/static/app.js">{"x()"}</script>;',
      ].join("\n"),
    });

    expect(linesFor(diagnostics, file, rule)).toEqual([1, 2, 3, 4, 6]);
  });
});

describe("layer boundaries (spec 2a)", () => {
  const rule = "eslint(no-restricted-imports)";

  it("lets the domain import only other domain modules", () => {
    const file = "src/domain/plan/plan.ts";
    const diagnostics = lint({
      [file]: [
        'import { Hono } from "hono";',
        'import { readFileSync } from "node:fs";',
        'import { createPlan } from "../../application/create-plan.ts";',
        'import { app } from "../../adapters/in/http/app.ts";',
        'import { pace } from "../values/pace.ts";',
        'import { rules } from "./rules.ts";',
        "export const all = [Hono, readFileSync, createPlan, app, pace, rules];",
      ].join("\n"),
    });

    expect(linesFor(diagnostics, file, rule)).toEqual([1, 2, 3, 4]);
  });

  it("keeps the application layer free of adapters, Node APIs and third-party libraries", () => {
    const file = "src/application/plans/create-plan.ts";
    const diagnostics = lint({
      [file]: [
        'import { drizzle } from "drizzle-orm/better-sqlite3";',
        'import { randomBytes } from "node:crypto";',
        'import { repo } from "../../adapters/out/sqlite/plans.ts";',
        'import { Plan } from "../../domain/plan/plan.ts";',
        'import type { PlanRepository } from "../ports.ts";',
        "export const all = [drizzle, randomBytes, repo, Plan];",
        "export type R = PlanRepository;",
      ].join("\n"),
    });

    expect(linesFor(diagnostics, file, rule)).toEqual([1, 2, 3]);
  });

  it("lets browser code import only client modules and Leaflet (spec 2)", () => {
    const file = "src/client/map.ts";
    const diagnostics = lint({
      [file]: [
        'import { Hono } from "hono";',
        'import { readFileSync } from "node:fs";',
        'import { publicAreaFrom } from "../domain/geo.ts";',
        'import { searchPlaces } from "../application/places.ts";',
        'import { toGpx } from "../adapters/out/gpx/write-gpx.ts";',
        'import L from "leaflet";',
        'import "leaflet/dist/leaflet.css";',
        'import { readCoordinate } from "./geo.ts";',
        "export const all = [Hono, readFileSync, publicAreaFrom, searchPlaces, toGpx, L, readCoordinate];",
      ].join("\n"),
    });

    expect(linesFor(diagnostics, file, rule)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("no ambient time or randomness in domain and application (spec 2b)", () => {
  const rule = "rendezroute(no-ambient-effects)";
  const source = [
    "export const a = Date.now();",
    "export const b = new Date();",
    "export const c = Math.random();",
    "export const d = crypto.randomUUID();",
    "export const e = crypto.getRandomValues(new Uint8Array(4));",
    'export const f = new Date("2026-01-01T00:00:00Z");',
  ].join("\n");

  it.each(["src/domain/clock-use.ts", "src/application/clock-use.ts"])(
    "reports them in %s",
    (file) => {
      expect(linesFor(lint({ [file]: source }), file, rule)).toEqual([1, 2, 3, 4, 5]);
    },
  );

  it("allows them in adapters", () => {
    const file = "src/adapters/out/system-clock.ts";
    expect(linesFor(lint({ [file]: source }), file, rule)).toEqual([]);
  });
});
