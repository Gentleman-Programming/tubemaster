# TubeMaster roadmap: guarded channel operations before automation

TubeMaster is evolving from a channel-operations workspace toward agent-assisted analysis and publishing. The six phases below are priorities, not a release commitment. Every write remains human-authorized, channel-bound, previewable where applicable, and subject to the repository's safety contracts.

## Quick path

1. Check [current status](#current-status) before assuming a feature exists.
2. Use the [phases](#phases) to locate delivered foundations and remaining work.
3. Review the [safety requirements](#safety-requirements) before scoping any new sensitive mutation.

## Current status

**Delivered:** guarded channel writes with `expectedChannelId`, confirmations and `dryRun` where supported; typed errors; quota estimates and observational operation events; video selection and JSON/CSV export; batch metadata preview, confirmation, apply and execution reports; authenticated analytics summary, period comparisons, traffic-source analysis, video retention visualization and publish-time analysis; transcript acquisition through authenticated/public providers and local Whisper with timestamps; thumbnail recovery; private-first video upload with staged-file validation; scheduling preview, timezone conversion, status reads and confirmation; social publishing foundations; and interface documentation.

These are controlled foundations, not an autonomous publishing product. Analytics access requires the existing authorized analytics scope. Quota estimates are not authoritative provider balances, and observational operation events are not a durable audit database. Upload and scheduling keep channel identity, file identity, metadata, confirmation and operation outcomes explicit.

**Remaining roadmap work:** durable audit/history, broader trend and Shorts-performance analytics, periodic and multi-video reporting, transcript indexing/embeddings/semantic search, editorial/SEO planning, and upload/scheduling recovery, cancellation, review-history and adapter hardening. The current feature-2 head is `ffb67a21a8c4b9917693b01f0af14d184a57d0c3`.

## Phases

| Phase | Delivered | Remaining boundary |
| --- | --- | --- |
| 1. Secure foundation | Read/write separation, channel guards, confirmations, typed errors, quota estimates and operational logging | Durable audit/history, stronger reconciliation and continued hardening before sensitive writes |
| 2. Analytics | Authenticated summary, comparisons, traffic sources, retention and publish-time analysis | Shorts-specific performance and broader channel/video trend analysis |
| 3. Reporting | Selection, JSON/CSV export, batch preview/apply and execution reports | Periodic reports, richer multi-video analysis and broader reviewed reporting workflows |
| 4. Intelligent transcripts | Caption/provider fallback, authenticated/public acquisition, local Whisper and timestamps | Local indexing, embeddings and semantic search |
| 5. Editorial intelligence / SEO | Existing metadata preview and rule-based editorial foundations | Keywords, related videos, ideas, recommendations and editorial calendar workflows |
| 6. Advanced automation | Human-confirmed private upload and scheduling slices, including validation, preview, timezone conversion and status reads | Complete CLI/MCP adapters, review/history UI, cancellation/recovery and test-channel operational validation |

## Phase 6: guarded Shorts upload and scheduling

The private-upload and scheduling slices are implemented as distinct sensitive mutations. The safe path is **select file → validate → prepare metadata → preview → confirm channel and time → upload private → schedule → verify status**. Approval is bound to the staged file, channel, metadata and schedule immediately before mutation.

Implemented safeguards include bounded staging, path and file validation, `expectedChannelId`, private-only upload, dry-run validation, confirmation tokens, quota accounting, safe provider errors, uncertain-outcome handling, timezone conversion, stale-preview rejection and read-only scheduled-status queries. No one-call autonomous publish operation exists.

Remaining Phase 6 work must be separately scoped and approved: reconciliation after uncertain outcomes, cancellation/return-to-private policy where supported, complete CLI/MCP exposure, review/history UI, and operational validation on a test channel. Do not broaden this into autonomous publishing, bulk upload, or upload disguised as metadata mutation.

## Safety requirements

- Use only necessary documented OAuth scopes; fail closed on missing scopes, mismatched `expectedChannelId`, stale confirmation or changed file/metadata/time.
- Constrain files to an authorized workspace; reject nonexistent, changed, symlinked or out-of-bounds paths and path traversal. Never log credentials, tokens, local paths or video contents.
- Make retries idempotent or reconcile by operation identity and remote state. A timeout must never trigger a blind second upload.
- Estimate and observe quota for upload and related operations without presenting estimates as Google's authoritative balance.
- Keep preparation, validation, preview, upload, scheduling, status and cancellation separately reviewable. Read/status calls must not mutate.
- Record only safe operational context, preserve actionable errors, and keep compensation/recovery explicit.

## Non-goals

No autonomous publishing, bulk Shorts upload without per-item preview and confirmation, automatic video/audio/script generation, timezone-free scheduling, or upload disguised as a generic metadata update. This document does not authorize implementation or promise a delivery date.

## Next step

Choose one focused, approved slice from the remaining boundaries, starting with documentation-backed hardening or reporting/transcript intelligence. Keep each slice on its own branch and PR with applicable tests, validation evidence and explicit merge authorization. This documentation update makes no runtime change.
