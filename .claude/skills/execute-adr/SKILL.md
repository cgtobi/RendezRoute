---
name: execute-adr
description: Orchestrate implementation, DB scaffolding, Vite+ checks, tiered review, and commit for an ADR
model: sonnet
effort: medium
disable-model-invocation: true
---

Execute the approved ADR located at: $ARGUMENTS

Follow this exact sequence:

1. **Database Scaffolding (If Needed):** If `$ARGUMENTS` requires new Kysely migrations or test fixtures, spawn `db-helper` (Haiku) first to scaffold them.
2. **Implement:** Spawn `implementer` (Sonnet) with the path to `$ARGUMENTS` to write the core code and tests.
3. **Verify:** Spawn `test-runner` (Haiku) to run `npm run check` (plus `npm run build` if `src/client/` changed, and `npm run e2e` if UI/routes changed). Loop with `implementer` until all checks pass.
4. **Tiered Review:**
   - First, spawn `review-triage` (Haiku) to classify the `git diff`.
   - If triage returns `TIER: DEEP`, spawn `reviewer-deep` (Opus) with `$ARGUMENTS` and the `FOCUS_FILES`.
   - If triage returns `TIER: STANDARD`, spawn `reviewer-standard` (Sonnet) with `$ARGUMENTS`.
   - If Must-Fix issues are found, send them to `implementer`, re-run `test-runner`, and re-verify with the same reviewer.
5. **Commit:** Once the reviewer returns APPROVED and all checks pass, stage the changes, draft a conventional commit message, and ask me to confirm before running `git commit`.
