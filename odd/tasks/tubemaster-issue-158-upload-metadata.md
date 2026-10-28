# TubeMaster issue #158 — complete YouTube upload metadata
Approved issue: https://github.com/Gentleman-Programming/tubemaster/issues/158
Branch: `feat/issue-158-upload-metadata`; base: `feature-2` at `213a04fa6efe11e0e53110e84d5d1d16a00ee1e9`.

## Specs

### S1 — User-prioritized upload metadata
> pero antes, tendremos que ver la subida de videos (que ya está) pero faltan los datos como:
> - Kw
> - descripcion
> - etiquetas
> - idiomas
> - demas datos que te solicitas youtube

### S2 — Approved issue outcome
> Complete the existing private-video upload contract with the metadata that YouTube requires or operators need for a meaningful upload, while preserving preview, confirmation, channel guards, and private-only behavior.

### S3 — Required safety boundary
> Publishing, scheduling, or changing the private-only safety boundary.

### S4 — Required compatibility
> Preserve `expectedChannelId`, dry-run behavior, operation identities, quota accounting, safe errors, uncertain-outcome reconciliation, and existing single-video upload behavior.

## Tasks
- T1 — S1-S4 — Map the delivered upload flow and define the smallest compatible metadata contract — complete; commit: pending
- T2 — S1-S4 — Add validated metadata through upload core, provider, API, dashboard, CLI/MCP, and multi-video adapters — complete; commit: pending
- T3 — S1-S4 — Verify public-interface behavior, compatibility, documentation, and focused/full checks — complete; commit: pending

## Log

### L1
pero antes, tendremos que ver la subida de videos (que ya está) pero faltan los datos como:
- Kw
- descripcion
- etiquetas
- idiomas
- demas datos que te solicitas youtube

### L2
User authorized creating issue #158 after read-only review of the delivered upload flow. The issue was created with `type:feature`, then received `status:approved` under explicit user authorization.

### L3
Implementation completed in the isolated worktree without commit or publication. Metadata now flows through single and multi-video upload contracts, validation, confirmation bindings, YouTube `videos.insert`, dashboard, CLI JSON, MCP, and interface documentation. Supported fields are tags, categoryId, defaultLanguage, defaultAudioLanguage, license, selfDeclaredMadeForKids, and containsSyntheticMedia. Private-only visibility and existing channel, dry-run, quota, operation, safe-error, and reconciliation boundaries remain intact.

Verification evidence: focused upload/API/dashboard/CLI/MCP suite 40/40 passed; full serial `npm test` passed; `npm run lint` passed; `npx tsc --noEmit --incremental false` passed; `git diff --check` passed; isolated `npm ci` and `npm run build` passed. Build emitted the existing dynamic filesystem tracing warnings from `src/lib/video-upload/staging.ts`. The first build attempt using a dependency symlink was rejected by Turbopack because the symlink pointed outside the worktree; no source failure was inferred from that attempt.
