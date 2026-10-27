# TubeMaster issue #156 — CLI and MCP adapters for upload recovery
Branch: `feat/issue-156-cli-mcp-upload-recovery`; base: `feature-2` at `8077ac9d23390caefa8c1a391b166f362a29ca16`.
Issue: https://github.com/Gentleman-Programming/tubemaster/issues/156 (`status:approved`, `type:feature`).

## Specs

### S1 — Summary
> Expose the reviewed multi-video private-upload and upload-recovery operations through the CLI and MCP interfaces without broadening them into autonomous publishing.

### S2 — User need
> Operators can currently use the reviewed multi-video upload and recovery behavior through authenticated HTTP routes, but CLI and MCP clients cannot invoke the same guarded workflows. They need stable, structured access to previews, confirmations, ordered per-item outcomes, reconciliation, and explicit return-to-private recovery while retaining the existing safety boundaries.

### S3 — Scope
> - In scope:
>   - Add CLI and MCP adapters for multi-video private-upload preview and confirmed execution.
>   - Add CLI and MCP adapters for single and ordered multi-item reconciliation.
>   - Add CLI and MCP adapters for dry-run and explicitly confirmed return-to-private recovery where the provider supports it.
>   - Preserve authenticated user binding, `expectedChannelId`, confirmation tokens, quota estimates, stable error envelopes, unknown outcomes, and ordered item results.
>   - Document the commands/tools and their preview/confirmation boundaries.
> - Out of scope:
>   - Autonomous retries, cancellation, publishing, scheduling, or deletion.
>   - New OAuth scopes, provider capabilities, or UI history/review work.
>   - Changing existing HTTP route contracts or making multi-video upload public by default.

### S4 — Acceptance criteria
> - CLI and MCP preview calls return the same safe validation and confirmation information as the reviewed HTTP workflows.
> - Confirmed CLI and MCP execution performs no mutation before a matching confirmation and preserves the authenticated user and `expectedChannelId` guards.
> - Reconciliation returns deterministic success, absence, unsupported, or unknown statuses without triggering a retry; multi-item results preserve input order and per-item operation identities.
> - Return-to-private requires explicit confirmation and provider capability checks; unsupported or ambiguous outcomes never claim cancellation success.
> - Invalid input, missing authentication, stale confirmation, channel mismatch, quota-accounting failure, and provider errors use stable sanitized error envelopes.
> - Existing HTTP, single-video, and reviewed multi-video behavior remains unchanged.

### S5 — Validation plan
> - Add public CLI and MCP tests for preview/confirm boundaries, authentication, channel guards, quota accounting, stable errors, ordered multi-item outcomes, reconciliation, unsupported providers, unknown outcomes, and return-to-private confirmation.
> - Run the serial test suite, ESLint, TypeScript, production build, and `git diff --check`.
> - Verify no CLI or MCP path performs an automatic retry or remote mutation without explicit confirmation.

### S6 — Dependencies and risks
> Builds on the approved and merged upload-recovery slice in issue #154 / PR #155 and the reviewed multi-video private-upload slice in issue #152 / PR #153. Preserve existing OAuth scopes and public JSON contracts. Risk is concentrated in adapter parity: a mismatch could bypass confirmation or channel guards, so adapters must delegate to the existing guarded core rather than duplicate provider calls.

## Tasks
- T1 — S1-S3 — Explore existing CLI, MCP, upload, recovery, authentication, error and documentation contracts; commit: pending (exploration complete).
- T2 — S3-S4 — Add RED public-interface tests and implement CLI/MCP adapters without bypassing guarded cores; commits: pending (implementation and focused validation complete).
- T3 — S4-S5 — Run focused and full validation, review the diff, and record evidence; commits: pending (validation complete).

## Log
- L1 — User instruction: "autorizo"
- L2 — Issue #156 was created, read back, and approved with `status:approved` and `type:feature` before implementation.
- L3 — User selected the roadmap line for CLI/MCP multi-video adapters after issue #154 was merged.
- L4 — Existing CLI and MCP surfaces use stable JSON/text envelopes, active credential resolution, strict schemas and shared cores; new adapters delegate to the guarded upload/recovery cores and use staged file inputs for multi-video upload.
- L5 — Added CLI `upload multi|reconcile|reconcile-many|cancel`, MCP `upload_multi|upload_reconcile|upload_reconcile_many|upload_cancel`, registration, public tests, and interface documentation. Preview/confirmation, channel, quota, unknown-outcome and ordering behavior remains in the shared core.
- L6 — Focused adapter tests (94 tests), serial full test suite, ESLint, TypeScript, production build, and `git diff --check` passed. The production build emitted existing dynamic-filesystem tracing warnings for `src/lib/video-upload/staging.ts`; the build still completed successfully.
- L7 — Risk: item 3 (new CLI/MCP public command and tool contracts share the existing parser and registration surfaces; existing behavior remains covered by the full suite).
