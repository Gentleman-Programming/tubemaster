# Contributing to TubeMaster

TubeMaster welcomes focused contributions that keep the CLI, MCP server, and API contracts safe for automation.

## Start here

1. **Open an issue** for bugs, contract changes, or larger features.
2. **Keep PRs focused** on one behavior change at a time.
3. **Document validation** in the PR description: commands run, scenarios checked, or why validation was not possible.

## Local setup

```bash
npm install
npm run dev
```

Create `.env.local` before using YouTube-backed flows:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

## Validation

Run the local checks before opening a PR:

```bash
npm ci
npm run test
npm run lint
npx tsc --noEmit
npm run build
```

GitHub Actions repeats these checks for pull requests and pushes targeting `feature-2` using Node.js 22.14.0. Its test step adds `--test-concurrency=1` because the SQLite-backed suite can contend when test files run in parallel. The workflow uses read-only repository permissions, does not require application credentials, and cancels superseded runs for the same ref. A failed step blocks the workflow and should be fixed before merging.

During installation, npm may warn that `node-domexception` is deprecated. It arrives transitively through `@libsql/client`; the warning is upstream-owned, and this project intentionally does not suppress or override it.

## Contribution standards

- **Preserve contracts**: CLI/MCP JSON envelopes should stay backward-compatible unless the issue explicitly proposes a breaking change.
- **Fail closed**: write operations must keep safety checks like `expectedChannelId`.
- **Return typed errors**: user-facing failures should be actionable and stable enough for automation.
- **Avoid broad rewrites**: refactors are welcome when they make a specific change safer or clearer.

## Pull request checklist

- [ ] The change is scoped to one problem or feature.
- [ ] Tests or validation notes are included.
- [ ] CLI/MCP/API contract changes are documented.
- [ ] New environment variables are documented in `README.md`.
- [ ] Screenshots or terminal output are included for user-facing changes.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
