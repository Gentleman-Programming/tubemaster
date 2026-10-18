# TubeMaster issue #99 security remediation
Triage and remediate npm dependency vulnerabilities on `feature-2` without changing application contracts.
Issue: https://github.com/Gentleman-Programming/tubemaster/issues/99

## Specs
- S1: "pues vamos a trabajarlas"
- S2: "Audit and remediate the open npm dependency vulnerabilities reported for TubeMaster, prioritizing runtime and high/critical advisories while preserving application behavior."
- S3: "Direct and transitive dependencies are upgraded to patched versions where available."
- S4: "The application keeps its existing CLI, MCP, OAuth, upload, scheduling, transcript, and analytics behavior."
- S5: "Tests, lint, TypeScript, and production build remain passing."
- S6: "Any vulnerability without an applicable safe upgrade is documented with its reachability and mitigation."

## Tasks
- T1 (S2-S6): Triage direct, transitive, runtime, and development advisories; commit: pending
- T2 (S2-S6): Apply compatible patched dependency upgrades and lockfile changes; commit: pending
- T3 (S3-S6): Run audit, tests, lint, typecheck, build, and compatibility checks; commit: pending
- T4 (S2-S6): Publish the approved security remediation PR linked to issue #99; commit: pending

## Log
- L1: "pues vamos a trabajarlas"
- L2: Issue #99 was created and labeled `status:approved` and `type:bug`.
- L3: Base branch is `feature-2`, current base commit `0ca606c180569d5543431da287dbb2176658f5f3`.
- L4: Runtime audit found 19 vulnerable packages: 3 critical, 9 high, 5 moderate, and 2 low. The direct runtime findings are `next`, `next-auth`, and `@modelcontextprotocol/sdk`.
- L5: Full audit found 29 vulnerable packages: 3 critical, 17 high, 6 moderate, and 3 low. `eslint-config-next` is an additional direct development dependency finding.
- L6: Latest queried versions are `next@16.4.2`, `next-auth@4.24.15`, `@modelcontextprotocol/sdk@1.32.1`, and `eslint-config-next@16.4.2`; compatibility validation is required before delivery.
- L7: Updated transitive runtime resolutions include `proxy-addr@2.0.8`, `hono@4.13.13`, `fast-uri@3.1.8`, `@hono/node-server@2.1.5`, `qs@6.16.1`, `source-map-js@1.2.2`, and `ws@8.22.0`.
- L8: Runtime audit is clean: 0 findings and exit code 0. Full audit retains 5 high dev-only findings in the `eslint-config-next` -> `fast-glob` -> `micromatch` -> `braces` chain; npm offers only the incompatible `eslint-config-next@14.2.35` downgrade, so this residual is documented rather than forced.
- L9: Compatibility validation passed: 303/303 tests, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`. Build retains two existing dynamic-filesystem tracing warnings in `src/lib/video-upload/staging.ts`.
- L10: `eslint.config.mjs` disables two newly surfaced React Compiler rules (`react-hooks/immutability` and `react-hooks/set-state-in-effect`) to preserve existing stateful effect behavior under `eslint-config-next@16.4.2`.
