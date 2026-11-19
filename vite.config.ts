import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// Absolute so the lint guard test (test/lint) can reuse this config from a temporary directory.
const plugin = fileURLToPath(new URL("./lint/rendezroute-plugin.js", import.meta.url));

// Spec 2a dependency rule: adapters → application → domain. One ordered group per layer:
// oxlint merges separate pattern groups, which silently disables later ones.
const onlyRelative = ["*", "!./**", "!../**"];

export default defineConfig({
  lint: {
    ignorePatterns: ["dist/**", "coverage/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [plugin],
    plugins: ["typescript", "unicorn", "oxc", "import", "vitest"],
    rules: {
      "rendezroute/no-inline-style-script": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/consistent-type-imports": "error",
      "typescript/no-explicit-any": "error",
      eqeqeq: "error",
      "no-console": "error",
      // Helpers named expect* (e.g. expectNoExactStart) count as assertions.
      "vitest/expect-expect": ["warn", { assertFunctionNames: ["expect", "expect*"] }],
    },
    overrides: [
      {
        files: ["src/domain/**"],
        rules: {
          "rendezroute/no-ambient-effects": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [...onlyRelative, "**/application/**", "**/adapters/**"],
                  message: "The domain may import only other domain modules (spec 2a).",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["src/application/**"],
        rules: {
          "rendezroute/no-ambient-effects": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [...onlyRelative, "**/adapters/**"],
                  message:
                    "The application layer may import only domain and application modules (spec 2a).",
                },
              ],
            },
          ],
        },
      },
      {
        // Browser code: only other client modules and Leaflet; never server code or Node APIs.
        files: ["src/client/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    ...onlyRelative,
                    "!leaflet",
                    "!leaflet/**",
                    "**/adapters/**",
                    "**/application/**",
                    "**/domain/**",
                  ],
                  message: "Browser code may import only client modules and Leaflet (spec 2).",
                },
              ],
            },
          ],
        },
      },
      {
        // The composition root and the entry points are where the process talks to the console.
        files: ["src/main.ts", "src/cli.ts", "src/ha-start.ts", "test/**"],
        rules: { "no-console": "off" },
      },
    ],
  },
  fmt: {
    printWidth: 100,
    ignorePatterns: ["LICENSE"],
  },
  // Browser code (spec 2: bundled and served by the instance, never from a CDN). Fixed file
  // names, so pages need no build manifest.
  publicDir: false,
  // Asset URLs relative to the file that uses them (fonts.css), so they work under any path prefix.
  base: "./",
  build: {
    outDir: "public/build",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: "src/client/app.ts",
        map: "src/client/map.ts",
        sw: "src/client/sw.ts",
        // Inter from the bundle (decision D27); its subsets load only for the characters a page uses.
        fonts: "src/client/fonts.css",
        // Archivo Narrow for the "archivo" palette only; the layout links it just for that palette.
        "archivo-fonts": "src/client/archivo-fonts.css",
      },
      output: { entryFileNames: "[name].js", assetFileNames: "[name][extname]" },
    },
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
    // RSA key generation and real listeners are slow when the machine is loaded.
    testTimeout: 15_000,
    // Reuse the forked workers across files instead of one fresh worker per file (decision D84).
    // Measured on 232 files and 3072 tests: about 27-28 s down to about 19-20 s. Risk: module
    // state, process.env, globals and fake timers now persist between files in one worker. Three
    // plain runs and four shuffled runs (files and tests, different seeds) passed; a new test
    // that leaks such state may fail an unrelated file, so restore fakes in afterEach.
    // Rule: a test that uses vi.mock must call vi.resetModules() before importing the code under
    // test (and in afterAll), or a cached unmocked copy from an earlier file is reused. The guard
    // test/lint/mock-isolation.test.ts enforces it.
    isolate: false,
  },
});
