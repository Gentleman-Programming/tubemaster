# TubeMaster issue #89 — dashboard scheduling preview and confirmation UX

- Issue: https://github.com/Gentleman-Programming/tubemaster/issues/89
- Branch: `feat/issue-89-scheduling-ui`
- Base: `feat/issue-87-scheduling` / PR #88
- Status: implemented; manual browser dry-run pending

## Specs

1. Add dashboard controls for scheduling an existing private video with date, time, and IANA timezone.
2. Show the UTC conversion and target channel/video in a preview before mutation.
3. Require explicit confirmation and send the scheduling preview token, exact video/channel/timezone/time, and `confirmed: true`.
4. Render safe validated, scheduled, authentication, validation, provider, and uncertain outcomes; preserve `operationId` for reconciliation.
5. Keep upload behavior unchanged; exclude job runners, autonomous publishing, bulk scheduling, status/cancellation, CLI/MCP, thumbnails, playlists, and captions.

## Tasks

- [x] Add scheduling controls to dashboard.
- [x] Wire preview and confirmation states.
- [ ] Run focused UI tests, TypeScript, lint, and manual browser dry-run.

## Log

L1: User confirmed the backend scheduling slice was tested and asked to continue with the dashboard experience.
L2: Issue #89 was approved for implementation and is stacked on PR #88's scheduling backend.
L3: Implemented Specs 1–5 in the separate dashboard scheduling form and focused helper tests; focused test, TypeScript and scoped lint passed.

## Validation

- Focused UI tests: 7/7 passed.
- Combined backend/UI tests: assertions passed but parallel runner exited with existing SQLite BUSY file-level failures; serial execution is the reliable check.
- Serial full TypeScript tests: 301/301 passed.
- Serial UI component tests: 7/7 passed.
- TypeScript: `tsc --noEmit --incremental false` passed.
- Scoped ESLint: passed.
- `git diff --check`: passed.
- Manual browser dry-run: pending on the local dashboard.

## Commit

Work-unit commit: `d7337fc` (`feat(dashboard): add scheduling confirmation UX`).
