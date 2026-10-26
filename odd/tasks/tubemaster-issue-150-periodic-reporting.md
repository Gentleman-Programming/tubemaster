# TubeMaster issue #150 — periodic read-only reporting
Branch: `feat/issue-150-periodic-reporting`; base: `feature-2` at `66032418deb7c172d2d1bfb0fb678619f5b20326`.
Issue: https://github.com/Gentleman-Programming/tubemaster/issues/150 (`status:approved`).

## Specs

### S1 — Summary
> Add a focused, read-only periodic-reporting workflow that lets an authenticated channel owner review the same analytics report shape across explicit reporting periods without requiring a background scheduler.

### S2 — User need
> Channel owners can compare selected videos for one requested current and previous period, but they do not yet have a repeatable periodic-reporting workflow for reviewing successive periods. They need consistent, exportable read-only reports that preserve the existing channel and analytics safety boundaries.

### S3 — Scope
> - Add user-invoked periodic report presets or period navigation over explicit date ranges using the existing read-only Analytics scope.
> - Reuse the existing multi-video report selection, current/previous metrics, aggregates, deltas, and local JSON/CSV export contracts where applicable.
> - Validate date ranges and selected visible videos before resolving credentials or calling the provider.
> - Keep the work read-only: no new OAuth scopes, provider writes, persistence, notifications, background jobs, or scheduler.
> - Keep the implementation isolated behind a focused route/service/UI contract and preserve existing Analytics summary behavior.

### S4 — Acceptance criteria
> - A user can request successive explicit reporting periods for the same bounded video selection through the public Analytics interface.
> - Each result reports the selected period, comparison period, per-video metrics, aggregate totals, and deterministic deltas.
> - Invalid periods and invalid selections fail with stable, actionable errors before credential resolution or provider calls.
> - JSON and CSV exports represent the displayed report locally without additional provider calls.
> - Existing Analytics summary and current multi-video report behavior remain compatible.
> - Tests cover the named success, boundary, validation, export, and regression cases through public interfaces.

### S5 — Validation plan
> - Add focused route, service, reporting, and UI tests for period navigation/presets, validation, exports, and regression behavior.
> - Run the direct reporting tests, the serial full suite, TypeScript, lint, production build, and `git diff --check`.
> - Verify no new OAuth scope, provider write, persistence, scheduler, notification, or background-job path is introduced.

### S6 — Dependencies and risks
> Depends on the merged read-only multi-video reporting contracts from PR #149. Keep the existing Analytics summary dependency contract isolated from report-specific querying. The primary risk is broadening shared Analytics behavior or accidentally introducing scheduling/persistence; mitigate with separate contracts, bounded scope, and regression tests.

## Tasks
- T1 — S1-S3 — Explore existing multi-video report period contracts and design the bounded period-navigation route; commit: 42f5a55.
- T2 — S3-S4 — Implement periodic report presets/navigation with focused service, route, UI, and regression tests; commit: 42f5a55.
- T3 — S4-S5 — Run direct and full validation, update user-facing documentation where behavior changes, and record evidence; commit: 42f5a55.

## Log
- L1 — User request: "actualiza el roadmap y prosigue con el trabajo del mismo"
- L2 — Periodic reporting selected as the next roadmap slice after issue #148 delivery.
- L3 — Issue #150 created and approved with `status:approved` before source changes.
- L4 — Implemented `shiftReportPeriod` with inclusive previous/next navigation, future-period rejection, and existing report-range validation reuse in `src/lib/reporting/multi-video-report.ts`.
- L5 — Added read-only `Previous period` and `Next period` controls to `src/components/analytics-multi-video-report.tsx`; next navigation is disabled when it would exceed today.
- L6 — Added reporting tests covering backward/forward shifts, future-period rejection, and invalid range rejection in `src/lib/youtube-analytics-summary/__tests__/reporting.test.ts`.
- L7 — Validation evidence: focused reporting tests 12/12; full `npm test` passed with all serial suites green; TypeScript, ESLint, production build, and `git diff --check` passed. Build retained only the two pre-existing dynamic filesystem tracing warnings. No dependency changes or new read/write/scheduler paths were introduced.
