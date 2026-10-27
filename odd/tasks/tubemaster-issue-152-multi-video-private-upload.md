# TubeMaster issue #152 — reviewed multi-video private upload
Branch: `feat/issue-152-multi-video-private-upload`; base: `feature-2` at `7da15a76144d4e0cf0fb50a0f923ddb9bd874e57`.
Issue: https://github.com/Gentleman-Programming/tubemaster/issues/152 (`status:approved`, `type:feature`).

## Specs

### S1 — Summary
> Add a focused, human-reviewed workflow to upload multiple videos privately in one operation while keeping each video independently validated, previewed, confirmed, and reported.

### S2 — User need
> Channel owners who prepare several videos currently need to repeat the single-video private upload workflow manually. They need a bounded multi-video workflow that reduces repetition without turning upload into autonomous or unreviewed bulk publishing.

### S3 — Scope
> In scope:
> - Accept a bounded collection of authorized local video files for private-only upload.
> - Validate every item before any provider mutation, including file identity, supported format, size, and authorized workspace boundaries.
> - Produce an ordered per-item preview with channel identity, file identity, metadata, estimated quota, and expected outcome.
> - Require explicit confirmation for the complete reviewed collection immediately before upload.
> - Upload items privately with per-item results, operation identities, safe errors, and uncertain-outcome guidance.
> - Preserve `expectedChannelId`, dry-run behavior where supported, quota accounting, and existing single-video upload contracts.
> - Keep concurrency bounded and make retry/reconciliation behavior explicit.
>
> Out of scope:
> - Scheduling or publishing any video.
> - Autonomous or unreviewed bulk upload.
> - A one-call publish operation or bypass of per-item validation and confirmation.
> - Metadata, thumbnail, playlist, captions, CLI, MCP, or social publishing expansion unless separately approved.
> - Changing OAuth scopes without a separate security review.

### S4 — Acceptance criteria
> - Invalid, missing, changed, symlinked, out-of-bounds, unsupported, oversized, or empty files are rejected before any provider upload.
> - A mixed collection produces deterministic item ordering and does not upload items when collection-level validation fails.
> - Preview identifies every item, the expected channel, private visibility, metadata, quota estimate, and confirmation binding without exposing credentials or local paths.
> - Confirmation is required immediately before upload and binds the reviewed collection, item identities, metadata, expected channel, and dry-run state.
> - Each attempted item returns a safe ordered result with video ID when known, operation identity, status, and actionable error classification.
> - Provider timeouts or uncertain outcomes instruct the user to reconcile before retrying and never trigger a blind second upload.
> - Existing single-video upload behavior and CLI/MCP/API contracts remain compatible.

### S5 — Validation plan
> - Add public-interface tests for collection validation, deterministic ordering, all-or-nothing preflight, confirmation binding, bounded execution, per-item results, provider failures, and uncertain outcomes.
> - Run focused upload tests, the serial full suite, TypeScript, lint, production build, and `git diff --check`.
> - Verify dry-run and read-only paths without uploading or publishing a production video.

### S6 — Dependencies and risks
> Depends on the existing private upload, staging, quota, confirmation, and channel-guard contracts. This is a sensitive write with data and concurrency risk: keep preflight side-effect-free, bound concurrency, preserve operation identities, reconcile uncertain provider outcomes before retry, and isolate the feature behind a focused contract. Issue #89 is a related scheduling UI issue but explicitly excludes scheduling multiple videos; scheduling remains out of scope here.

## Tasks
- T1 — S1-S3 — Explore existing private upload, staging, confirmation, quota, and channel-guard contracts; commit: pending.
- T2 — S3-S4 — Add public-interface RED tests and implement bounded multi-video private upload preview/confirmation/execution while preserving single-video contracts; commit: pending.
- T3 — S4-S5 — Run focused and full validation, document evidence, and review the final diff; commit: pending.

## Log
- L1 — User request: "continua"
- L2 — User clarification: "apunta en en roadmap lo de la subida de multi-videos"
- L3 — User scope decision: "Sí, solo subida privada".
- L4 — Issue #152 created and approved with `status:approved` before source changes.
- L5 — Issue #89 duplicate search completed; it is a closed scheduling UI issue that explicitly excludes scheduling multiple videos.
- L6 — Added a focused collection service with deterministic per-item preview, SHA-256 file identity binding, HMAC confirmation tokens, all-item preflight, bounded execution, ordered outcomes, and uncertain-result preservation. Existing single-video upload contracts remain unchanged.
- L7 — Focused upload regression validation passed 15/15; TypeScript, ESLint, and `git diff --check` passed. Full suite and production build remain pending.
- L8 — Added the staged-file adapter and `/api/youtube/upload/multi` route with session binding, supported-format/size/boundary/symlink checks, confirmed snapshots, safe API errors, and no local-path exposure in previews. Focused validation passed 22/22; full suite, lint, TypeScript, build, and `git diff --check` passed.
