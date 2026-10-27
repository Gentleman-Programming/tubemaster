# TubeMaster issue #154 — upload reconciliation and cancellation hardening
Branch: `feat/issue-154-upload-recovery`; base: `feature-2` at `cd883794f528aa65eed28e12641fcc24f41e1cb0`.
Issue: https://github.com/Gentleman-Programming/tubemaster/issues/154 (`status:approved`, `type:feature`).

## Specs

### S1 — Summary
> Harden upload and scheduling recovery by making uncertain provider outcomes reconciliable by operation identity and by defining a safe, explicitly confirmed cancellation/return-to-private path where the provider supports it.

### S2 — User need
> Channel owners need a safe way to determine whether an upload completed after a timeout or other uncertain provider response, and to stop or return an operation to a private state when cancellation is supported. They need recovery guidance that never duplicates a provider mutation or implies cancellation succeeded when the provider cannot guarantee it.

### S3 — Scope
> - In scope:
>   - Define a stable reconciliation contract for uncertain upload outcomes using the existing operation identity and channel guard.
>   - Reconcile remote state before allowing or recommending a retry, preserving unknown when the provider cannot establish a safe result.
>   - Define an explicit, confirmed cancellation/return-to-private contract for provider capabilities that support it.
>   - Return ordered, safe statuses and actionable error classifications for single-video and reviewed multi-video workflows.
>   - Preserve quota accounting, `expectedChannelId`, private-only behavior, and existing API contracts.
> - Out of scope:
>   - Autonomous retries, autonomous cancellation, or autonomous publishing.
>   - Deleting remote videos or changing visibility without explicit confirmation.
>   - Scheduling changes, OAuth scope changes, CLI/MCP expansion, or UI review-history work unless separately approved.

### S4 — Acceptance criteria
> - An uncertain provider outcome always preserves its operation identity and never triggers a blind second mutation.
> - Reconciliation queries the provider using the operation identity and returns a deterministic known-success, known-failure, or still-unknown status without leaking credentials or local paths.
> - A retry is rejected or withheld until reconciliation establishes that no prior mutation succeeded.
> - Cancellation requires explicit confirmation, `expectedChannelId`, and a provider capability check; unsupported or ambiguous cancellation fails closed without claiming success.
> - Return-to-private results preserve safe operation identities, statuses, and actionable errors for each affected item.
> - Existing single-video and reviewed multi-video upload behavior remains compatible and all current tests continue to pass.

### S5 — Validation plan
> - Add public-interface tests for timeout reconciliation, known remote success, known remote absence, still-unknown outcomes, duplicate-prevention, confirmed cancellation, unsupported cancellation, channel mismatch, and ordered multi-item results.
> - Run focused recovery tests, the serial full test suite, ESLint, TypeScript, production build, and `git diff --check`.
> - Verify read-only reconciliation paths do not mutate provider state and that cancellation is never attempted without explicit confirmation.

### S6 — Dependencies and risks
> Builds on the guarded single-video upload and reviewed multi-video private upload delivered in PR #153. Provider APIs may not expose a reliable operation identity or cancellation primitive for every mutation; those cases must remain explicitly unknown or unsupported. Preserve existing OAuth scopes and fail closed on channel, capability, confirmation, or reconciliation ambiguity.

## Tasks
- T1 — S1-S3 — Explore existing upload, scheduling, operation identity, provider, channel guard, quota, and confirmation contracts; commit: 5e10785 (exploration complete).
- T2 — S3-S4 — Add RED public-interface tests and implement reconciliation plus explicitly confirmed cancellation/return-to-private behavior without blind retries; commits: 5e10785, b4c9f28.
- T3 — S4-S5 — Run focused and full validation, review the diff, and record evidence; commits: 5e10785, b4c9f28 (complete).

## Log
- L1 — User request: "continua"
- L2 — User selected the roadmap line: "Hardening de uploads".
- L3 — User selected combined scope: "Ambos en una issue".
- L4 — Issue #154 created, read back, and approved with `status:approved` before source changes.
- L5 — Existing YouTube upload operation IDs are local and the provider has no durable mutation cursor. Recovery therefore preserves the local operation ID and requires an optional provider video ID; without it, reconciliation returns explicit `unsupported` rather than guessing by metadata or retrying.
- L6 — Implemented generic recovery service, ordered batch reconciliation, authenticated routes, YouTube inspection/return-to-private adapter, explicit confirmation tokens, channel checks, quota accounting, and unknown-outcome preservation. No automatic retry or remote deletion was added.
- L7 — Focused recovery tests, full serial test suite, ESLint, TypeScript, production build, and `git diff --check` passed before delivery preparation.
