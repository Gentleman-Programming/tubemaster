# TubeMaster issue #87 — schedule private uploads with publishAt

- Issue: https://github.com/Gentleman-Programming/tubemaster/issues/87
- Branch: `feat/issue-87-scheduling`
- Base: `feature-2` at `a8c0305`
- Status: complete

## Specs

1. Add a separate scheduling operation for an already-uploaded private video; do not combine upload and publish.
2. Require `videoId`, `expectedChannelId`, an explicit timezone, `publishAt`, dry-run/preview support, and explicit confirmation before mutation.
3. Display/return UTC conversion; reject malformed, ambiguous, past, wrong-channel, stale-confirmation, and non-private-video requests without mutation.
4. Keep the video private until YouTube's scheduled publication time and return safe typed outcomes, quota estimate, and operation identity.
5. Keep job runners, autonomous publishing, CLI/MCP, status/cancellation UI, thumbnails, playlists, captions, and public upload changes out of scope.

## Tasks

- [x] Define scheduling contract and validation.
- [x] Implement guarded YouTube scheduling service.
- [x] Expose authenticated scheduling route and tests.
- [x] Run full validation and commit (parent owns commit).

## Log

L1: User requested continuing the defined TubeMaster program after private upload and Dependabot work.
L2: Issue #87 was approved for implementation after a read-only exploration of current upload, write-context, quota, and route seams.
L3: Added a separate guarded schedule operation with IANA timezone wall-time conversion, signed 10-minute preview confirmation, provider video state check, and best-effort list/update quota estimates. Focused tests, TypeScript, scoped ESLint, and full TypeScript test suite pass.

## Validation

- Focused scheduling tests: 7/7 passed.
- Full TypeScript test suite: 301/301 passed.
- TypeScript: `tsc --noEmit --incremental false` passed.
- Scoped ESLint: passed.
- `git diff --check`: passed.
- No live YouTube mutation was performed; live API validation remains pending.

## Commit

Work-unit commit: `148d638` (`feat(youtube): schedule private uploads`).
