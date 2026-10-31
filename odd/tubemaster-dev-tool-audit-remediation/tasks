# TubeMaster development-tool audit remediation
Branch: `chore/dev-tool-audit-remediation` from `feature-2` at `9afdb2d1a5b12d2864ff90e50882f4338f8829cd`.
Scope: remove the remaining development-only audit findings without downgrading the ESLint/Next stack or changing runtime behavior.

## Specs

1. **S1** — "como lo solucionamos?"
2. **S2** — "pues continua"
3. **S3** — Use a targeted, non-forced remediation for the ESLint/minimatch development dependency graph. Do not apply `npm audit fix --force`, downgrade ESLint, or downgrade `eslint-config-next`.
4. **S4** — Keep production dependencies and runtime/API contracts unchanged, and validate the resulting dependency graph with the repository checks and both full and production-only npm audits.

## Tasks

- T1 — S1-S3 — Identify and apply compatible development-tool dependency metadata updates — commit: pending
- T2 — S4 — Run tests, lint, type-check, build, and npm audit checks — commit: pending
- T3 — S2-S4 — Prepare a linked approved pull request without merging it — commit: pending

## Log

- **L1** — como lo solucionamos?
- **L2** — pues continua
- **L3** — User authorized applying a targeted fix and preparing a PR, but did not authorize merging it.
- **L4** — Baseline at `9afdb2d`: full npm audit reports 16 moderate development-only findings; production-only audit reports zero. Current direct tooling is `eslint@^9` and `eslint-config-next@16.4.3`; npm's force recommendation is incompatible and must not be used.
