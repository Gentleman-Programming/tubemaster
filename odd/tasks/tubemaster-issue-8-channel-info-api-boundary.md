# TubeMaster issue #8 — channel-info API error boundary

## Parent issues

- `Gentleman-Programming/tubemaster#5` — Expand TubeMaster from playlist manager into channel operations platform.
- `Gentleman-Programming/tubemaster#8` — Harden flagged security and error boundaries.

## Focused slice

Normalize failures at the YouTube channel-info API route boundary while preserving safe quota and public response behavior.

## Scope

- Map auth, provider, validation, and unexpected failures to typed HTTP envelopes.
- Preserve channel resolution and quota accounting behavior.
- Sanitize unknown errors and avoid leaking provider details.
- Add deterministic route regression coverage.

## Non-goals

- Other API routes.
- Auth, playlist, provider adapter, quota, audit, analytics, or UI changes.

## Allowed edit surfaces

- `src/app/api/youtube/channel-info/route.ts`
- `src/app/api/youtube/channel-info/route.test.ts`
- `src/app/api/youtube/channel-info/route.quota.test.ts`
- This task document

## Validation

- Focused route tests.
- Full test suite, TypeScript, lint, and `git diff --check`.
