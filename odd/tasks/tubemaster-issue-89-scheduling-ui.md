# TubeMaster issue #89 — dashboard scheduling preview and confirmation UX

- Issue: https://github.com/Gentleman-Programming/tubemaster/issues/89
- Branch: `feat/issue-89-scheduling-ui`
- Base: `feat/issue-87-scheduling` / PR #88
- Status: implemented; manual browser dry-run pending

## Specs

1. Add dashboard controls for selecting an existing private video from a dropdown, with date, time, and IANA timezone dropdown.
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
L4: User correction: "ha de ser desplegable" — timezone selection must be a dropdown, not free text.
L5: Replaced the free-text timezone field with a curated IANA timezone dropdown and added regression coverage.
L6: User reported: "Existing private video ID ha puesto una hora" — prevent browser autofill from copying schedule values into the video ID field.
L7: Added explicit names, autocomplete-off, and text input hints to isolate video ID/date/time controls.
L8: Follow-up screenshot showed the video ID still rendered as a time input; correct the input-type mapping so only `time` uses `type="time"`.
L9: User selected "Selector desplegable de videos" — load private videos for the active channel and remove manual ID entry.
L10: Added `privateOnly=1` filtering to the existing video list route and replaced manual video ID entry with an accessible select.
L11: User confirmed the channel has no private video yet; clarified the empty state to instruct confirming a private upload first.
L12: Manual screenshot showed the native segmented time control retaining an invalid partial value; replace it with explicit hour/minute selectors.
L13: Replaced the native segmented time input with separate accessible hour/minute dropdowns and kept `publishAt` normalized as `HH:MM`.

## Follow-up commit

Timezone dropdown correction: `7bf2e6f` (`fix(dashboard): use timezone dropdown`).

## Validation

- Focused UI tests: 7/7 passed.
- Combined backend/UI tests: assertions passed but parallel runner exited with existing SQLite BUSY file-level failures; serial execution is the reliable check.
- Serial full TypeScript tests: 301/301 passed.
- Serial UI component tests: 7/7 passed.
- TypeScript: `tsc --noEmit --incremental false` passed.
- Scoped ESLint: passed.
- `git diff --check`: passed.
- Manual browser dry-run: authenticated Chrome verified the private video selector, hour/minute persistence, UTC preview, and safe no-change response; no real confirmation was submitted.
- Timezone dropdown correction: focused UI tests 8/8, TypeScript, scoped ESLint, and `git diff --check` passed.
- Private-video selector: route/component tests 10/10, TypeScript, scoped ESLint, and `git diff --check` passed.
- Explicit time selectors: route/component tests 11/11, TypeScript, scoped ESLint, and `git diff --check` passed.
- Partial-time regression: Chrome reproduced hour reset because only the combined `time` value was controlled; separate `scheduleTimeParts` state now preserves hour/minute independently until both form `HH:MM`.
- Final validation: serial full suite 301/301 and UI suite 10/10 passed after the partial-time fix.

## Commit

Work-unit commit: `dee2053` (`fix(dashboard): preserve partial schedule time selections`).
