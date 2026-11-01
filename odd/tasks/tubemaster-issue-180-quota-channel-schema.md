# Issue 180 quota channel schema

Repository: `Gentleman-Programming/tubemaster`
Issue: https://github.com/Gentleman-Programming/tubemaster/issues/180

## Specs

- S1: "Tendremos que solucionarlo"
- S2: Preserve the observed error exactly: `SQLITE_ERROR: no such column: channel_id`.
- S3: The quota usage path must support the existing `channelId` filter without breaking legacy quota rows that have no channel identity.
- S4: The schema change must be idempotent for fresh databases and existing databases.

## Tasks

- T1 (S1-S2): Reproduce the quota schema mismatch and map the repository/query paths; route: inline; commit: 9ede7aa.
- T2 (S1,S3-S4): Add the additive `channel_id` schema migration and persist channel identity while retaining nullable legacy rows; route: inline; commit: 9ede7aa.
- T3 (S2-S4): Add focused regression coverage for initialization, inserts, filtering, and legacy rows; route: inline; commit: 9ede7aa.
- T4 (S1-S4): Run focused/full validation and record evidence; route: inline; commit: 9ede7aa.

## Log

- L1: "Tendremos que solucionarlo"
- L2: Issue #180 was created and read back as OPEN with exactly the `type:bug` label after operational validation reproduced the missing-column error.
- L3: The affected branch is based on `feat/durable-audit-history` at `4ae420b`; the dirty local checkout has a different newer quota schema and is not the implementation target.
- L4: Focused migration tests passed 18/18. Full `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed after installing dependencies locally in the isolated worktree.
- L5: Independent verification found that the web repository path ignored the exposed `channelId` filter; the implementation was corrected to filter, group, and return channel identity, with a regression test passing 5/5.
- L6: Final focused tests passed 23/23; full `npm test`, lint, TypeScript, build, and `git diff --check` passed; independent verification approved the hardened migration and query behavior. Work-unit commit: `9ede7aa` (`fix(quota): align channel schema with queries`).
