# TubeMaster issue #110 — Analytics retention rebased onto latest feature-2

Rebase the pending read-only Analytics retention work onto the latest remote UI without overwriting the collaborator redesign.

Delivery strategy: single-pr; slice boundary is the retention work-unit commit (462 authored lines).

## Specs

- **S1** — "las estadisticas hay que sacarlas a otra pestaña en el dasboard"
- **S2** — "Add an explicit video selector for the authenticated channel."
- **S3** — "Add a separate dashboard tab dedicated to video-retention statistics."
- **S4** — "Query YouTube Analytics read-only retention data for the selected video using the existing authorized analytics access."
- **S5** — "Display retention data with clear loading, empty, provider-error, and invalid-selection states."
- **S6** — "No persistence, scheduled reports, automated recommendations, or publishing actions."
- **S7** — "No new OAuth scopes."

## Tasks

- T1 (S1-S7) — Rebase retention contracts, route, provider query, tests, and UI onto origin/feature-2 — route — commit `b54cd7a`.
- T2 (S1-S7) — Run focused/full checks and browser verification — verification — commit `b54cd7a`.

## Log

- L1: "abre un worktree compara\n-tenemos que subir los cambios que teniamos pendientes\n-tenemos que actualizarnos a los nuevos cambios"
- L2: The clean comparison worktree is based on `origin/feature-2` at `de1e588`, which includes the merged Gentleman UI redesign, social publishing, calendar, and date-time picker.
- L3: The previous pending worktree contains retention changes that must be adapted rather than copied wholesale because the latest remote changed the dashboard shell and shared UI primitives.
