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
        // The composition root and the CLI are where the process talks to the console.
        files: ["src/main.ts", "src/cli.ts", "test/**"],
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
  build: {
    outDir: "public/build",
    emptyOutDir: true,
    rollupOptions: {
      input: { map: "src/client/map.ts" },
      output: { entryFileNames: "[name].js", assetFileNames: "[name][extname]" },
    },
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
