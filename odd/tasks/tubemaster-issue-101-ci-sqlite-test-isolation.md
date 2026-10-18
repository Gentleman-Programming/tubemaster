# TubeMaster issue #101 CI SQLite test isolation
Make the repository test command deterministic when tests import the shared SQLite database during module initialization.
Issue: https://github.com/Gentleman-Programming/tubemaster/issues/101

## Specs
- S1: "The post-merge CI run can fail because separate test processes initialize the shared SQLite database concurrently, producing `SQLITE_BUSY` and an unhandled rejection after a test has completed."
- S2: "The CI test command completes deterministically with all tests passing and no asynchronous database activity after a test process exits."
- S3: "No public API, quota accounting, or database schema behavior changes beyond initialization safety."

## Tasks
- T1 (S1-S2): Reproduce the failing test-runner behavior and isolate the process concurrency cause; commit: 85f0dbc
- T2 (S1-S3): Implement a deterministic sequential test runner without changing runtime database behavior; commit: 85f0dbc
- T3 (S2-S3): Run full validation and the GitHub CI workflow; commit: 85f0dbc
- T4 (S1-S3): Publish the approved CI fix PR linked to issue #101; commit: 85f0dbc

## Log
- L1: "mira los ci en gh que no pasan"
- L2: GitHub run `39153497077` on merged commit `0080016dd558dbc0bb71f226a55323efe136e2df` ran 305 tests, passed 303, and failed quota/batch/channel-info files with `SQLITE_BUSY`.
- L3: Issue #101 was created and labeled `status:approved` and `type:bug`.
- L4: The current `npm run test -- --test-concurrency=1` reproduces the race locally; running the same test files as separate sequential Node processes passes.
- L5: The sequential runner completed 303 tests with 303 passes; lint, TypeScript, production build, and `git diff --check` passed. Build emitted existing Turbopack filesystem-tracing warnings unrelated to this change.
- L6: Commit `85f0dbc` contains the deterministic runner, package script change, and ODD evidence.
