# TubeMaster durable audit/history

Feature specification for the approved durable audit/history roadmap slice on `feature-2`.
Implementation must preserve privacy filtering, user isolation, and non-blocking operation semantics.

## Specs

### S1 — Event coverage
> Todas las operaciones

The first slice covers the existing operational event vocabulary plus upload, scheduling, social, analytics, recovery, and other operation paths that already expose safe operation identity or lifecycle outcomes. No raw credentials, tokens, titles, descriptions, prompts, transcript text, provider payloads, or local paths may be persisted.

### S2 — Retention
> 90 días fijos

Persisted events have a fixed 90-day retention policy with deterministic cleanup. Cleanup must be bounded, repeatable, and must not delete newer records.

### S3 — Visibility
> UI + API

Provide an authenticated, user-scoped read-only API and a dashboard history UI. Read access must not mutate operations or expose another user's records.

### S4 — Failure semantics
Durable audit writes remain observational: a persistence failure must not change the operation result, retry a provider mutation, or block the user workflow. The failure is reported through safe diagnostics.

### S5 — Safety and compatibility
Preserve existing sanitized event vocabulary and context allowlists, server-side credential handling, channel guards, confirmation requirements, CLI/MCP/API contracts, and existing operation behavior. No autonomous publishing or new mutation is authorized by this slice.

## Tasks
- T1 (S1,S4,S5): Define the durable event schema, sanitizer boundary, and operation adapter contract; commit: `33dfb7a`.
- T2 (S1,S2,S4): Persist all covered lifecycle events with user isolation and bounded 90-day cleanup; commits: `33dfb7a`, `2e95049`, `fd05a36`.
- T3 (S3,S5): Add authenticated read-only history API and dashboard UI with explicit empty/loading/error states; commit: `33dfb7a`.
- T4 (S1-S5): Add public-interface tests for persistence, retention, isolation, sanitizer rejection, read-only access, and failure non-interference; commit: `33dfb7a`.
- T5 (S1-S5): Update roadmap/interfaces documentation and validate the complete work unit; commit: `5fe0c67` (interfaces documentation; final validation pending).

## Log
- L1: continuamos con el roadmap
- L2: User selected durable audit/history as the next roadmap direction.
- L3: User selected the exact options `Todas las operaciones`, `90 días fijos`, and `UI + API` for the first slice.
- L4: Approved implementation issue: https://github.com/Gentleman-Programming/tubemaster/issues/178 (labels: `status:approved`, `type:feature`).
- L5: Focused tests pass for repository, retention, sanitizer/sink isolation, and authenticated history API; `npx tsc --noEmit`, `npm run lint`, and `git diff --check` pass for the implemented slice.
- L6: Full `npm test` passes (48 test groups, 0 failures) and `npm run build` passes with `/dashboard/audit` and `/api/audit/history` included.
- L7: Request-level audit coverage now wraps the authenticated operation routes in commits `2e95049` and `fd05a36`; all stored events remain sanitized and user-scoped.
