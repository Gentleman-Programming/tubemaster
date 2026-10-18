# TubeMaster issue #107 — Analytics traffic-source breakdowns
Branch: `feat/analytics-traffic-sources`
Issue: https://github.com/Gentleman-Programming/tubemaster/issues/107

## Specs

- **S1** — "Add read-only YouTube Analytics traffic-source breakdowns to the existing Analytics dashboard and period-comparison flow."
- **S2** — "Query the existing YouTube Analytics API with `trafficSourceType` as the dimension and the existing supported summary metrics."
- **S3** — "Return validated traffic-source rows through the authenticated analytics route without persistence or new OAuth scopes."
- **S4** — "Display current-period traffic-source totals and the equivalent previous-period comparison in the Analytics dashboard."
- **S5** — "Include the breakdown in the existing local CSV export."
- **S6** — "Empty provider rows render a clear empty state without crashing or inventing data."
- **S7** — "Malformed provider rows return the existing typed Analytics API error and do not produce partial results."
- **S8** — "Existing daily analytics, period comparison, authentication, and error behavior remain unchanged."

## Tasks

- T1 (S2-S3, provider contracts and mapping) — add traffic-source types, adapter query, validation, and tests. Commit: pending.
- T2 (S3-S5, route and dashboard) — expose data, comparisons, rendering, and CSV behavior. Commit: pending.
- T3 (S6-S8, verification and delivery) — run checks, update docs, and publish issue-linked PR. Commit: pending.

## Log

- L1: "Para el primer slice de Analytics ampliado, ¿qué métrica priorizamos? La base actual solo consulta series diarias read-only de 90 días." — selected "Fuentes de tráfico".
- L2: "Add read-only YouTube Analytics traffic-source breakdowns to the existing Analytics dashboard and period-comparison flow."
