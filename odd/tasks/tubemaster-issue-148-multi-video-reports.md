# TubeMaster issue #148 — Read-only multi-video reports
Feature specification for `feat(reporting): add read-only multi-video reports`.
Implement on `feat/issue-148-multi-video-reports`; keep Analytics read-only and preserve existing contracts.

## Specs

### S1 — Multi-video selection
“Select multiple videos already visible to the authenticated channel.”
“A bounded multi-video selection is validated before provider calls.”

### S2 — Stable report contract
“Reuse the existing read-only YouTube Analytics access and normalized metrics.”
“Produce per-video rows, aggregate totals, and deterministic comparisons/deltas.”
“The report exposes per-video metrics plus aggregate totals and deterministic deltas for the selected period.”

### S3 — Local export
“Support local JSON and CSV export of the displayed report without a second provider request.”
“JSON and CSV export serialize the displayed report locally without additional provider calls.”

### S4 — Safe states
“Present loading, empty, invalid-selection, authentication/scope, and provider-error states safely.”
“Empty, loading, invalid-selection, auth/scope, and provider-error states are covered without leaking provider details.”

### S5 — Regression safety
“Existing analytics and reporting behavior remains unchanged.”
“Deterministic tests cover selection boundaries, normalization, aggregation, deltas, export, and rejected input with no downstream calls.”

### S6 — Explicit non-goals
“New OAuth scopes.”
“Analytics or YouTube writes, publishing, scheduling, recommendations, or metadata mutation.”
“Persisted reports, background schedulers, email delivery, or autonomous periodic jobs.”
“Replacing the existing date-range controls or selected-video export contract.”

## Tasks

- T1 (S1-S2): Add bounded selection and read-only multi-video report services/contracts/tests; commit: 4d51907.
- T2 (S3-S4): Add report serialization and authenticated analytics UI states/export; commit: 4d51907.
- T3 (S5-S6): Run focused/full validation, review diff, and document evidence; commit: 4d51907.

## Log

- L1: `continua`
- L2: Issue #148 was selected as the next approved roadmap slice after confirming issue #94 only covers completed date-range reporting and issue #10 covers selected-video JSON/CSV export.
