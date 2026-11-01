# TubeMaster semantic channel selection

Feature specification for the provider-neutral Semantic Search channel-selection slice on `feature-2`.
Implementation must preserve authenticated channel scope and leave embedding-provider integration deferred.

## Specs

### S1 — Channel source
> tendría que poder coger los videos del mismo canal no?

Semantic Search must let the authenticated user browse videos from the currently authorized channel instead of requiring only a manually entered video ID.

### S2 — Immediate implementation
> lo hacemos ya?

Implement this channel-selection slice now, in an isolated worktree and behind the existing authenticated dashboard route.

### S3 — Provider boundary
The accepted scope is provider-neutral: list and select channel videos, support selecting one, many, or all currently loaded videos, and preserve the existing provider/model/indexing-deferred message. Do not choose an embedding provider or persist embeddings in this slice.

### S4 — Safety and compatibility
Use the existing authenticated YouTube videos route and channel-selection/authorization boundaries. Do not expose credentials, cross-channel videos, or mutate YouTube data. Preserve the existing single-video ID validation behavior where the manual fallback remains available.

## Tasks
- T1 (S1,S4): Define the channel-video selection state and public response contract; commit: `d525bcf`.
- T2 (S1,S3,S4): Add authenticated channel video listing, filtering, selection, and select-all behavior to Semantic Search; commit: `d525bcf`.
- T3 (S2-S4): Add focused component/API regression tests and preserve existing manual validation; commit: `d525bcf`.
- T4 (S1-S4): Update interface documentation and validate the work unit; commit: `d525bcf` (final evidence pending).

## Log
- L1: tendría que poder coger los videos del mismo canal no?
- L2: lo hacemos ya?
- L3: User authorized creating and approving an issue for the provider-neutral channel-selection slice, without embeddings/provider integration.
- L4: Approved implementation issue: https://github.com/Gentleman-Programming/tubemaster/issues/179 (labels: `status:approved`, `type:feature`).
- L5: Focused component tests and full `npm test` pass (48 groups, 0 failures); `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass.
