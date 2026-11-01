# TubeMaster provider-free semantic indexing foundation

Feature specification for issue #184 on `feature-2`.
Implementation must define scoped transcript indexing without selecting an AI provider, embedding model, vector database, or similarity-search engine.

## Specs

### S1 — User-selected roadmap slice
> 1. Planificar semantic indexing sin IA
>     Definir chunking, persistencia, aislamiento por usuario, quotas y
>     contratos, sin elegir proveedor.

The implementation must cover deterministic chunking, scoped persistence, user/channel isolation, local indexing quotas, and provider-neutral contracts without choosing a provider.

### S2 — Approved issue scope
> Define and implement a provider-neutral semantic indexing foundation for transcript chunks without selecting or integrating an AI provider, embedding model, or vector database.

The implementation is limited to the approved issue #184 scope and must preserve the existing Semantic Search UI and authenticated channel-selection behavior.

### S3 — Safety boundary
> No OpenAI, Gemini, local model, subscription bridge, or other embedding-provider integration.
> No embedding generation, vector persistence, vector database, approximate-nearest-neighbor engine, or similarity search execution.
> No public, unauthenticated, CLI, or MCP indexing endpoint in this slice.
> No automatic scheduling, background jobs, or autonomous indexing.
> No YouTube publishing, metadata mutation, upload, or scheduling changes.

These exclusions are mandatory. AI/provider and vector decisions remain a later approved slice.

### S4 — Scope isolation and replacement
> Semantic persistence records and repository operations are scoped by both authenticated user and channel; cross-user and cross-channel reads return no data and writes cannot overwrite another scope.
> Re-indexing the same scoped video is idempotent, transactional, and removes stale chunks without affecting other videos or scopes.

Every semantic repository operation must require authenticated user and channel scope and use transactional replacement semantics.

### S5 — Resource accounting and compatibility
> Local indexing usage is bounded, observable, and separate from YouTube API quota accounting; exceeding the configured limit performs no partial write.
> Existing transcript, semantic-search UI, channel-selection, quota, audit, CLI, MCP, and upload contracts remain unchanged.

Local indexing accounting must not be represented as YouTube API units, and existing public contracts must remain compatible.

## Tasks
- T1 (S1-S5): Define versioned chunk/index request, result, status, limit, and typed-error contracts; route: implementation; commit: `f82694e`.
- T2 (S1,S4,S5): Add additive scoped semantic document/chunk persistence and repository replacement/list/delete operations; route: implementation; commit: `f82694e`.
- T3 (S4,S5): Add transactional replacement and separate local usage accounting with no-partial-write limits; route: implementation; commit: `f82694e`.
- T4 (S1-S5): Add focused contract, isolation, rollback, quota-limit, and unchanged-contract regression tests; route: tests; commit: `f82694e`.
- T5 (S1-S5): Update interface documentation, run validation, and record evidence; route: verification; commit: `f82694e`.

## Log
- L1: 1. Planificar semantic indexing sin IA
    Definir chunking, persistencia, aislamiento por usuario, quotas y
    contratos, sin elegir proveedor.
- L2: User authorized creating and approving an issue for the provider-free semantic indexing foundation.
- L3: Issue #184 created with the official Feature request form and exactly `type:feature`.
- L4: Issue #184 approved with exactly `status:approved` and `type:feature` after fresh target-host authority verification and read-back.
- L5: Focused semantic indexing tests pass 6/6 and TypeScript passes after explicit chunking-version validation was added.
- L6: Full npm test, lint, TypeScript, build, diff check, and proportional authenticated UI smoke passed. Work-unit commit: `f82694e`.
