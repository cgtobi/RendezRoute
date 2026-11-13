# Project Rules & Workflow

## Tech Stack & Tooling

- **Runtime & Toolchain:** Node 26.13.0, Vite+ (`vp`), TypeScript (`ES2024` + `Temporal`, `nodenext`).
- **Backend & DB:** Hono (`hono/jsx` for server-rendered JSX), SQLite with Kysely.
- **Testing:** Vitest (`npm test` / `vp test`), Playwright (`npm run e2e`).
- **Assets & Scripts:** Brand icon generation runs via `npm run icons` (`node scripts/brand-icons.ts`).

## Strict Architectural & Lint Constraints

- **Hexagonal Layering (Spec 2a):** Dependencies must point strictly inward (`adapters → application → domain`).
  - `src/domain/**`: Pure domain logic only. No ambient effects, no external packages, no `application` or `adapters` imports.
  - `src/application/**`: May import only `domain` and `application`. No ambient effects, no `adapters` imports.
  - `src/client/**`: Browser-only code (bundled to `public/build`). May import only other `src/client/**` modules and `leaflet`. Never import server code or Node APIs.
- **Code Style & Safety:**
  - Always use `.ts`/`.tsx` extensions in relative imports (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`).
  - Use `import type` for type-only imports (`verbatimModuleSyntax` + `consistent-type-imports`).
  - Account for `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` in all types.
  - Never use `any`, inline styles/scripts (`rendezroute/no-inline-style-script`), or `console.*` outside `src/main.ts`, `src/cli.ts`, and `test/**`.

## Context & Quota Protection

- **Codebase Search:** Always delegate multi-file searches, symbol tracing, and repo exploration to the `Explore` subagent (Haiku).
- **Database Boilerplate:** Delegate Kysely SQLite migration scaffolding and deterministic test fixture creation to the `db-helper` subagent (Haiku).
- **Verification & Logs:** Never run `npm run check`, `vp test`, `npm run build`, or `npm run e2e` directly in the main thread. Always delegate them to `test-runner` (Haiku).
- **ADRs:** Store architectural decisions and plans in `docs/adr/NNN-short-title.md`.

## Workflow Commands & Execution Pipeline

- **Design Phase (Opus Session):** Use `/brainstorm <topic>` to explore the codebase via `Explore` (Haiku), design the solution interactively, and generate `docs/adr/NNN-short-title.md`.
- **Execution Phase (Sonnet Session):** Use `/execute-adr <path-to-adr>` to run the full automated implementation, verification, tiered review, and commit pipeline.

For both `/execute-adr` runs and multi-file manual feature work, follow this sequence:

1. **Scaffold (If Needed):** Use `db-helper` (Haiku) for Kysely migrations and test fixtures.
2. **Implement:** Delegate core coding tasks to `implementer` (Sonnet).
3. **Verify:** Run `npm run check` (plus `npm run build` / `npm run e2e` when applicable) via `test-runner` (Haiku).
4. **Tiered Review:** Run `review-triage` (Haiku) on `git status --short` and `git diff` first, then route to `reviewer-deep` (Opus) for high-risk/domain/DB changes or `reviewer-standard` (Sonnet) for routine changes before committing.
