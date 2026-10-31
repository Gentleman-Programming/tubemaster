# TubeMaster roadmap: guarded channel operations before automation

TubeMaster is evolving from a channel-operations workspace toward agent-assisted analysis and publishing. The seven phases below are priorities, not a release commitment. Every write remains human-authorized, channel-bound, previewable where applicable, and subject to the repository's safety contracts.

## Quick path

1. Check [current status](#current-status) before assuming a feature exists.
2. Use the [phases](#phases) to locate delivered foundations and remaining work.
3. Review the [safety requirements](#safety-requirements) before scoping any new sensitive mutation.

## Current status

**Delivered:** guarded channel writes with `expectedChannelId`, confirmations and `dryRun` where supported; typed errors; quota estimates and observational operation events; video selection and JSON/CSV export; batch metadata preview, confirmation, apply and execution reports; multi-video and periodic read-only reporting; authenticated analytics summary, period comparisons, traffic-source analysis, video retention visualization and publish-time analysis; transcript acquisition through authenticated/public providers and local Whisper with timestamps; thumbnail recovery; private-first and reviewed multi-video upload with complete supported metadata; upload reconciliation and explicit return-to-private recovery; scheduling preview, timezone conversion, status reads and confirmation; CLI/MCP recovery adapters; social publishing foundations; and interface documentation.

These are controlled foundations, not an autonomous publishing product. Analytics access requires the authorized analytics scope. Quota estimates are not authoritative provider balances, and observational operation events are not a durable audit database. Upload and scheduling keep channel identity, file identity, metadata, confirmation and operation outcomes explicit.

**Remaining roadmap work:** durable audit/history, broader trend and Shorts-performance analytics, transcript indexing/embeddings/semantic search, editorial/SEO planning, review/history UI, and test-channel operational validation. Current semantic-search work is tracked by issues #160 and #161 and PR #162.

## Phases

| Phase | Delivered | Remaining boundary |
| --- | --- | --- |
| 1. Secure foundation | Read/write separation, channel guards, confirmations, typed errors, quota estimates and operational logging | Durable audit/history, dependency hardening, stronger reconciliation and continued review before sensitive writes |
| 2. Analytics | Authenticated summary, comparisons, traffic sources, retention, publish-time analysis and dashboard views | Shorts-specific performance and broader channel/video trend analysis |
| 3. Reporting | Selection, JSON/CSV export, batch preview/apply, execution reports, multi-video reports and periodic navigation | Broader reviewed reporting workflows |
| 4. Intelligent transcripts | Caption/provider fallback, authenticated/public acquisition, local Whisper and timestamps | Local indexing, embeddings and semantic search |
| 5. Editorial intelligence / SEO | Existing metadata preview and rule-based editorial foundations | Keywords, related videos, ideas, recommendations and editorial calendar workflows |
| 6. Advanced automation | Human-confirmed private upload, reviewed multi-video upload, metadata completion, scheduling, recovery/cancellation, and CLI/MCP adapters | Review/history UI and operational validation on a test channel |
| 7. Creator intelligence benchmark | No implementation committed; this phase records candidate capabilities for future planning | Keyword and trend research, data-backed ideas, competitor/outlier analysis, explainable metadata recommendations, thumbnail workflows, long-form-to-Shorts analysis, coaching, and cross-platform insights |

## Phase 6: guarded Shorts upload and scheduling

The private-upload and scheduling slices are implemented as distinct sensitive mutations. The safe path is **select file → validate → prepare metadata → preview → confirm channel and time → upload private → schedule → verify status**. Approval is bound to the staged file, channel, metadata and schedule immediately before mutation.

Implemented safeguards include bounded staging, path and file validation, `expectedChannelId`, private-only upload, complete supported upload metadata, dry-run validation, confirmation tokens, quota accounting, safe provider errors, uncertain-outcome handling, reconciliation, explicit return-to-private recovery where supported, timezone conversion, stale-preview rejection and read-only scheduled-status queries. No one-call autonomous publish operation exists.

Remaining Phase 6 work must be separately scoped and approved: review/history UI and operational validation on a test channel. Do not broaden this into autonomous publishing, unreviewed bulk upload, or upload disguised as metadata mutation.

## Transcript intelligence boundary

Issue #160 defines the provider-neutral semantic-search contract. Issue #161 adds the dedicated page UX. PR #162 carries both because the page depends on transcript indexing primitives, but the provider/model decision is intentionally deferred.

Future implementation must separately define transcript chunking, embedding model/provider, vector persistence, authenticated indexing/search routes, per-user isolation, quotas, replacement behavior, and browser smoke coverage. The UI must remain decoupled from provider credentials and provider-specific response shapes.

## Safety requirements

- Use only necessary documented OAuth scopes; fail closed on missing scopes, mismatched `expectedChannelId`, stale confirmation or changed file/metadata/time.
- Constrain files to an authorized workspace; reject nonexistent, changed, symlinked or out-of-bounds paths and path traversal. Never log credentials, tokens, local paths or video contents.
- Make retries idempotent or reconcile by operation identity and remote state. A timeout must never trigger a blind second upload.
- Estimate and observe quota for upload and related operations without presenting estimates as Google's authoritative balance.
- Keep preparation, validation, preview, upload, scheduling, status and cancellation separately reviewable. Read/status calls must not mutate.
- Record only safe operational context, preserve actionable errors, and keep compensation/recovery explicit.

## Phase 7: creator intelligence benchmark

vidIQ is a reference point for a possible future creator-intelligence phase, not a dependency or an integration commitment. The candidate capability set includes keyword and trend research; data-backed video ideas; competitor and outlier analysis; explainable title, description and tag recommendations; thumbnail review workflows; long-form-to-Shorts opportunity analysis; coaching-style guidance; and cross-platform insights. See [vidIQ features](https://vidiq.com/features/) for the external reference.

Any future implementation must remain provider-neutral and separate research from mutation: recommendations should be read-only, attributable to observed data, previewable, and reviewable before any metadata or publishing action. Provider credentials, model selection, quotas, persistence, and authenticated routes require a separate approved design. This phase must not authorize autonomous publishing, automatic script or media generation, unreviewed bulk changes, or copying vidIQ-specific response shapes into TubeMaster contracts.

## Non-goals

No autonomous publishing, unreviewed bulk Shorts upload, automatic video/audio/script generation, timezone-free scheduling, or upload disguised as a generic metadata update. This document does not authorize implementation or promise a delivery date.

## Next step

Choose one focused, approved slice from the remaining boundaries, starting with semantic-search integration planning, documentation-backed dependency hardening, or reviewed reporting/editorial work. Keep each slice on its own branch and PR with applicable tests, validation evidence and explicit merge authorization.
