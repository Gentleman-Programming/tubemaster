# Issue 45 — npm warning remediation

## Goal
Remove the unused `drizzle-kit` dependency and document the remaining upstream warning from the `@libsql/client` dependency chain.

## Scope
- Remove `drizzle-kit` from `package.json` and `package-lock.json`.
- Preserve `@libsql/client` and runtime database behavior.
- Document that `node-domexception` is a transitive upstream warning.
- Do not replace the SQLite client or suppress npm warnings globally.

## Acceptance criteria
- `drizzle-kit`, `@esbuild-kit/esm-loader`, and `@esbuild-kit/core-utils` are absent after install.
- `@libsql/client` remains available for `src/lib/db.ts`.
- Contributor documentation explains the remaining transitive warning and its ownership.
- Existing tests and lint pass.

## Validation
- `npm ci` succeeds; `node-domexception@1.0.0` still emits its upstream deprecation warning.
- `npm test` passes (220 tests); `npm run lint` passes.
- `npm ls drizzle-kit @esbuild-kit/esm-loader @esbuild-kit/core-utils @libsql/client --depth=0` shows only `@libsql/client`.
- Focused diff is reviewed.

## Delivery evidence
- Issue: https://github.com/Gentleman-Programming/tubemaster/issues/45
- Branch: `chore/remove-unused-drizzle-kit`
- Commit: pending
- Pull request: not opened (per request)
