# TubeMaster issue #161 — dedicated semantic search page
Implementation specification for the approved GitHub issue in `Gentleman-Programming/tubemaster`.

## Specs

### S1 — User direction
> no, una pagina separada

### S2 — Requested outcome
> Add a dedicated authenticated dashboard page for searching indexed transcript chunks with the provider-neutral semantic-search boundary from issue #160.

### S3 — Scope
> Add a dedicated authenticated dashboard route for transcript semantic search.
> Provide an Index video action shell that accepts a video URL/ID and clearly reports that model integration is pending.
> Provide a query input, bounded result limit, and clear submit/reset actions.
> Render the future search workflow's empty and provider-pending states without pretending that results exist.
> Show validation and provider-pending states with accessible status messaging.
> Follow existing dashboard navigation, styling, accessibility, and authenticated-route conventions.

### S4 — Non-goals
> No embedding provider or model integration in this slice.
> No persistence, indexing API, search API, upload, scheduling, or metadata changes.
> No public or unauthenticated search endpoint.
> No vector database or ranking algorithm changes.
> No automatic indexing or background jobs.

### S5 — Acceptance and validation
> An authenticated user can open a dedicated semantic-search page from the dashboard navigation.
> A valid query returns deterministic ranked transcript matches through a stable authenticated route.
> The UI renders match text, video identity, score, and an explicit no-results state.
> Invalid input is rejected before search execution with an actionable message.
> Missing authentication and server failures produce safe, accessible error states.
> Focused component and route tests cover success, no results, validation, unauthorized, and failure behavior.
> Existing transcript dashboard, CLI, MCP, and upload contracts remain unchanged.
> Run focused page, route, and semantic-search tests; full suite, lint, TypeScript, build, diff check; and authenticated local browser smoke.

## Tasks
- T1 (S1-S5): Reconcile approved issue and write implementation record; commit: `pending`.
- T2 (S2-S5): Implement the dedicated UI-only page, navigation, provider-pending states, and tests; commit: `baed898`.
- T3 (S5): Run page checks and local smoke; commit: none; focused tests 4/4, TypeScript, lint, build, and diff check pass; unauthenticated route smoke redirects `307` to `/` as expected.
- T4 (S5): Review diff and record outcome; commits: `25a6ff2`, `724be4c`.

## Log
- L1: no, una pagina separada
- L2: User approved issue #161 for implementation after the separate-page decision.
- L3: User chose the same-page `Index video` flow so the feature can be tested without a separate pre-indexing pipeline.
- L4: The user later narrowed issue #161 to page UX only; provider, persistence, and API work must be deferred until a model is selected.
- L5: The page uses local validation and provider-pending status messaging without claiming that indexing or search has executed.
- L6: Removed OpenAI provider, embedding storage, semantic-search API routes, related tests, and API configuration docs after the user requested a page-only slice; retained the dedicated route and navigation.
- L7: Focused UI/navigation tests pass 4/4. Clean TypeScript, lint, and diff checks pass after removing stale `.next` output; the production build passes and exposes `/dashboard/semantic-search`.
- L8: Unauthenticated local smoke returns `307` to `/`, confirming the dashboard route remains protected. Final UI-only implementation commit is `baed898`; no push or PR was performed at that point.
- L9: Added a future-work roadmap to `docs/interfaces.md` and documented the deferred provider/model integration in issue #161 before PR preparation.
