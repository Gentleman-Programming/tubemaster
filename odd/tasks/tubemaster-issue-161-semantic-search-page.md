# TubeMaster issue #161 — dedicated semantic search page
Implementation specification for the approved GitHub issue in `Gentleman-Programming/tubemaster`.

## Specs

### S1 — User direction
> no, una pagina separada

### S2 — Requested outcome
> Add a dedicated authenticated dashboard page for searching indexed transcript chunks with the provider-neutral semantic-search boundary from issue #160.

### S3 — Scope
> Add a dedicated authenticated dashboard route for transcript semantic search.
> Provide an Index video action that accepts a video URL/ID, obtains its transcript, generates OpenAI embeddings, and persists them for search.
> Provide a query input, bounded result limit, and clear submit/reset actions.
> Render ranked matches with video ID, transcript chunk text, similarity score, and source order/identity where useful.
> Show loading, empty, validation, unauthorized, unavailable, and generic error states.
> Add authenticated server-side routes for indexing and searching without exposing credentials.
> Follow existing dashboard navigation, styling, accessibility, and authenticated-route conventions.

### S4 — Non-goals
> No provider/model selection UI; the first implementation uses the configured OpenAI embedding model.
> No upload, scheduling, or metadata changes.
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
- T2 (S2-S5): Implement authenticated search/index routes, OpenAI embedding persistence, page/navigation, docs, and tests; commit: `a57f1a5`.
- T3 (S5): Run page checks and local smoke; commit: none; full test/build/diff checks pass, authenticated indexing unavailable without `OPENAI_API_KEY`.
- T4 (S5): Review diff and record outcome; commit: pending.

## Log
- L1: no, una pagina separada
- L2: User approved issue #161 for implementation after the separate-page decision.
- L3: User chose the same-page `Index video` flow so the feature can be tested without a separate pre-indexing pipeline.
- L4: OpenAI is the selected embedding provider; the server uses `OPENAI_API_KEY` and the configured/default model without exposing credentials to the browser.
- L5: The same-page flow indexes a YouTube transcript into per-user SQLite embeddings before searching; replacing one video's index does not delete another video or another user's entries.
- L6: Focused issue-161 tests pass 13/13; TypeScript, lint, and diff check pass. The current `.env.local` has no `OPENAI_API_KEY`, so live embedding/indexing smoke is intentionally not attempted.
- L7: Full test suite, production build, and diff check pass. The local server returns `200` for `/dashboard/semantic-search` and advertises the corrected `3102` OAuth callback.
- L8: Next.js regenerated the repository's `AGENTS.md` instruction block during local dev; that generated change is included in the verification commit to keep the worktree clean.
