# Issue 43 — npm warning Issue Form

## Goal
Add a YAML Issue Form for reproducible npm and dependency deprecation warnings.

## Scope
- Add `.github/ISSUE_TEMPLATE/npm-warnings.yml`.
- Collect warning output, dependency chain, expected outcome, and verification.
- Do not change application runtime behavior or dependency versions.

## Acceptance criteria
- Form is valid GitHub Issue Form YAML.
- Required warning details are validated.
- Form is discoverable under `.github/ISSUE_TEMPLATE/`.
- Existing workflows remain unaffected.

## Validation
- Parse YAML with an available parser or equivalent structural check.
- Verify the form contains required metadata, controls, and validations.
- Review the focused diff.

## Delivery evidence
- Issue: https://github.com/Gentleman-Programming/tubemaster/issues/43
- Branch: `chore/npm-warnings-issue-form`
- Commit: `1bdfc2c` (`chore(repo): add npm warning issue form`)
- Pull request: https://github.com/Gentleman-Programming/tubemaster/pull/44
