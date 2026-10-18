# TubeMaster issue #103 analytics period-over-period comparisons
Issue: https://github.com/Gentleman-Programming/tubemaster/issues/103
Branch: `feat/analytics-period-comparisons`

## Specs
- S1: "Add read-only period-over-period comparisons to the authenticated analytics dashboard so channel operators can understand whether daily performance metrics improved or declined relative to the immediately preceding equivalent period."
- S2: "Compare the selected 7-day, 30-day, 90-day, or custom period with the immediately preceding period of equal duration."
- S3: "Present current and previous totals for views, likes, comments, and estimated minutes watched, plus absolute and percentage deltas."
- S4: "Keep comparison requests bounded by the existing 90-day per-period limit; do not request or persist data beyond what the comparison needs."
- S5: "Absolute deltas and percentage deltas are deterministic, including an explicit non-misleading representation when the previous value is zero."
- S6: "Custom ranges compare against the immediately preceding range with the same inclusive day count and preserve the existing 90-day validation."
- S7: "Comparison data is fetched through the existing authenticated read-only analytics boundary and performs no writes or persistence."
- S8: "Existing analytics, dashboard, and repository tests remain green."
- S9: "Do not modify issue #3, which remains intentionally deferred."

## Tasks
- T1 (S2-S6): Define and test equivalent-period and metric-delta contracts/services; commit: pending
- T2 (S1-S4, S7): Integrate bounded comparison requests through the existing analytics API and dashboard UI; commit: pending
- T3 (S5, S7-S9): Update documentation, run focused/full validation, and publish the approved PR; commit: pending

## Log
- L1: "1"
- L2: "continua y deja apartada la #3"
- L3: Roadmap review confirmed Phase 2 Analytics as the next priority; issue #94/PR #95 already delivered period selection and reporting, so this slice adds period-over-period deltas without new OAuth scopes, persistence, or writes.
- L4: Issue #103 was created and labeled `type:feature` and `status:approved` after duplicate search found no existing comparison issue.
- L5: T1 RED was observed before implementation; the focused comparison suite now passes 4/4 with inclusive previous-period bounds, 90-day validation, totals, and zero-baseline percentage semantics.
