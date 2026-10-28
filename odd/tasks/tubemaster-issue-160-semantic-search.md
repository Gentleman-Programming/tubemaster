# TubeMaster issue #160 — semantic search boundary
Implementation specification for the approved GitHub issue in `Gentleman-Programming/tubemaster`.

## Specs

### S1 — User direction
> transcripts → embeddings/semantic search

### S2 — Requested outcome
> Define the provider-neutral semantic-search boundary for TubeMaster transcripts, using the indexed transcript chunks and embedding contract already delivered in issues #19, #20, and #21.

### S3 — Scope and acceptance
> Define a provider-neutral semantic-search input/output contract over transcript video and chunk identities.
> Accept a query embedding and search constraints without choosing how the query is embedded.
> Return deterministic ranked matches with score, videoId, chunk identity, and the persisted transcript metadata needed to explain each result.
> Enforce embedding metadata compatibility (provider, model, and vector dimension) and fail safely for empty queries, incompatible vectors, and unavailable candidates.
> Preserve existing chunk identity, ordering, and storage contracts.
> Keep the boundary read-only and independently testable.

### S4 — Non-goals
> No OpenAI, Gemini, local model, or other embedding-provider integration.
> No vector database, approximate-nearest-neighbor engine, or storage migration.
> No ranking model beyond the explicitly defined deterministic similarity ordering.
> No transcript retrieval, embedding generation, indexing rewrite, UI, CLI, MCP, or public API changes.
> No automatic scheduling or background jobs.

### S5 — Verification
> Add focused unit tests for valid ranked results, deterministic ties, empty/invalid queries, metadata mismatch, and no candidates.
> Run the full test suite, lint, TypeScript checks, and build if the implementation changes runtime code.
> Run `git diff --check` and verify existing CLI/MCP/API contracts are unchanged.

## Tasks
- T1 (S1-S5): Reconcile transcript dependency commits with `origin/feature-2`; commit: `95fc37d`.
- T2 (S2-S5): Implement the provider-neutral semantic-search boundary and focused tests; commit: pending.
- T3 (S5): Run focused and repository checks; commit: none.

## Log
- L1: transcripts → embeddings/semantic search
- L2: User approved implementation and selected integrating dependencies into `feature-2` after branch divergence was discovered.
- L3: The full merge of the historical transcript branch conflicted across unrelated current feature-2 files; the implementation branch retained feature-2 and restored only the transcript chunk/index/embedding dependency surfaces plus the transcript index table.
- L4: Commit `95fc37d` records the dependency restoration boundary; it is 626 authored lines because the historical dependency surfaces were absent from current feature-2.
- L5: Focused transcript tests pass 30/30; full test suite, lint, TypeScript, and diff check pass. Build remains unavailable because Turbopack rejects the isolated worktree's symlinked node_modules as outside the filesystem root.
