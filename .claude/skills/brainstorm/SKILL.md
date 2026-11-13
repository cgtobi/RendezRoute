---
name: brainstorm
description: Brainstorm a feature or architecture and write a structured ADR
model: opus
effort: high
disable-model-invocation: true
---

We are starting an interactive brainstorming session for: $ARGUMENTS

1. First, spawn the `Explore` subagent to map existing files across `src/domain`, `src/application`, `src/adapters`, `src/client`, and `test/`.
2. Based on its findings, ask me clarifying questions about domain modeling, Kysely schema impacts, Hono routes/JSX, or client bundle constraints before proposing a design.
3. Once we agree on the approach, write a detailed Architecture Decision Record to `docs/adr/` (using the next available number) covering: Context, Decision, Layer-by-Layer File Plan, Database/Migration Notes (if any), and Verification Criteria (unit vs. Playwright E2E).
