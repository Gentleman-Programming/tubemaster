# TubeMaster Troubleshooting

<- [Back to README](../README.md)

This page maps common errors to concrete fixes.

## OAuth / login errors

### `AUTH_CALLBACK_INVALID`

Typical causes:

- Loopback callback timeout in CLI login
- Redirect URI mismatch in Google Cloud
- Invalid callback state/code

Checks:

1. Verify OAuth redirect URIs in Google Cloud:
   - `http://localhost:3000/api/auth/callback/google`
   - `http://127.0.0.1:8787` (or your configured callback port)
2. Retry CLI login:
   - `npm run cli:video-metadata -- auth login`
3. If the browser does not open, copy the OAuth URL printed in the console and open it manually.
4. If callback port is custom, set `CLI_OAUTH_CALLBACK_PORT` and update redirect URI.

### CLI browser opener diagnostics

The CLI keeps the OAuth URL in console output so login still works when the OS browser opener fails.

| Platform | Opener command | Maintenance note |
| --- | --- | --- |
| Windows | `rundll32.exe url.dll,FileProtocolHandler <url>` | Validated with and without debug instrumentation. Preserve this form; alternatives such as shell-only launchers can fail in packaged or npm-run contexts. |
| macOS | `open <url>` | Standard OS opener. |
| Linux | `xdg-open <url>` | Requires a desktop opener to be available. |

Troubleshooting flow:

1. Run `npm run cli:video-metadata -- auth login`.
2. If no browser opens, manually open the OAuth URL printed by the command.
3. If maintaining the opener code, enable diagnostics:
   - PowerShell: `$env:CLI_OAUTH_OPENER_DEBUG="1"; npm run cli:video-metadata -- auth login`
   - cmd.exe: `set CLI_OAUTH_OPENER_DEBUG=1 && npm run cli:video-metadata -- auth login`
4. Check stderr for JSON lines with `scope: "cli-oauth-opener"`.
5. Keep `CLI_OAUTH_OPENER_DEBUG` unset for normal use; it is intentionally opt-in because it prints the OAuth URL and process details.

### `AUTH_USER_NOT_FOUND`

Meaning: no active local auth context was resolved.

Fix:

1. Login again:
   - `npm run cli:video-metadata -- auth login`
2. Verify:
   - `npm run cli:video-metadata -- auth whoami`

### `AUTH_REFRESH_TOKEN_MISSING`

Meaning: stored credentials cannot refresh access token.

Fix:

1. Re-authenticate with consent prompt (CLI login does this by default).
2. Ensure OAuth consent flow can issue offline access.

### `AUTH_SCOPE_INSUFFICIENT`

Meaning: token exists but lacks required scope(s).

Fix:

1. Confirm OAuth consent screen includes:
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/youtube`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
2. Revoke prior authorization (Google Account → Security → Third-party access) or run local logout, then log in again to grant the new scope set.

### Transcript unavailable: `permissions-insufficient`

Meaning: transcript provider reached YouTube captions endpoints, but current token does not have the required scope set.

Fix:

1. Ensure OAuth consent/client includes `https://www.googleapis.com/auth/youtube.force-ssl` (alongside `youtube.readonly` and `youtube`).
2. Revoke prior authorization or logout to clear old grants.
3. Login again:
   - `npm run cli:video-metadata -- auth login`
4. Retry transcript command:
   - `npm run cli:video-metadata -- transcript --videoId <VIDEO_ID>`

---

## Write guardrail errors

TubeMaster protects sensitive writes with expected channel checks.

### `WRITE_CHANNEL_REQUIRED`

Meaning: write operation needs expected channel, but none was provided/resolved.

Fix:

- Pass `--expectedChannelId <UC...>` on CLI mutation commands.
- Or persist channel selection first:
  - `npm run cli:video-metadata -- auth list-channels`
  - `npm run cli:video-metadata -- auth select-channel --channelId <UC...>`

### `WRITE_CHANNEL_MISMATCH`

Meaning: expected channel does not match active OAuth channel.

Fix:

1. Re-auth with the intended account/channel.
2. Or select the currently active channel as expected.

### `WRITE_CHANNEL_UNRESOLVED`

Meaning: expected channel exists, but active OAuth channel could not be resolved.

Fix:

1. Re-authenticate.
2. Re-check context with `auth whoami`.

---

## Metadata/API errors

### `target_language_unresolvable`

Meaning: app could not infer target language for metadata apply.

Fix the YouTube video metadata state so one of these is true:

- `snippet.defaultLanguage` is set, or
- exactly one localization locale exists.

### `validation_failed`

Common reasons:

- Missing required CLI flags (`--videoId`, `--expectedChannelId`, etc.)
- Invalid JSON payload in API routes
- Invalid tool input in MCP

Fix: check command/JSON payload against [docs/interfaces.md](./interfaces.md).

### `unauthorized` / HTTP `401`

Meaning: no authenticated session/token for current interface.

Fix:

- Web UI: sign in again from `/`
- CLI/MCP: run CLI `auth login`

---

## Environment issues

### App starts but auth fails immediately

Check required env vars exist in `.env.local`:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`

### Wrong callback host/port

- Web callback uses `NEXTAUTH_URL` + `/api/auth/callback/google`
- CLI callback uses `http://127.0.0.1:<CLI_OAUTH_CALLBACK_PORT|8787>`

Make sure Google OAuth redirect URIs match these exactly.

-> Next: [docs/getting-started.md](./getting-started.md)

<- [Back to README](../README.md)
