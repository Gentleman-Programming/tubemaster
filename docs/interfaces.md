# TubeMaster Interfaces: Web UI, CLI, MCP, API

<- [Back to README](../README.md)

Use this as the operational reference after setup: TubeMaster covers channel workflows across metadata, transcripts, playlists, rules, and automation surfaces.

## Operation audit events

Service workflows emit `start` before work and one terminal `success`, `dry_run` (metadata apply only), or `failure` event afterward. Vocabulary: `video_metadata.list`, `video_metadata.preview`, `video_metadata.apply`, `transcript.get`, and `playlist.list`, `playlist.create`, `playlist.update`, `playlist.delete`, `playlist.add_videos`, `playlist.remove_videos`, each followed by `.<phase>`. The logger writes `{ level, event, timestamp, context }` JSON lines; `timestamp` is an ISO date. Context is strictly restricted to scalar `operationId`, `channelId`, `videoId`, `playlistId`, `dryRun`, `count`, `code`, and `transcriptStatus`. Channel IDs appear only when resolved/available; operation IDs correlate lifecycle events and quota context where passed. Failure `code` is a mapped domain code, never a raw provider error. No credential, title, description, editorial prompt, transcript text, or nested payload is logged. A batch operation can succeed with per-item failures; its existing response retains those details without embedding them in audit events.

The default metadata logger streams JSON lines to stderr. Playlist events are emitted only if a logger is injected into playlist services. These events are not stored in SQLite and have no app-managed retention or query API; retention is determined by the process supervisor or log collector. Audit delivery is best-effort, not durable, and does not alter responses or block writes.

## Web UI (`http://localhost:3000`)

### Login flow

1. Open home page.
2. Click **Sign in with Google**.
3. On success, app redirects to `/dashboard`.

### Dashboard tabs

- **Manual**
  - Browse your videos (`/api/youtube/videos`) or paste IDs/URLs in batch mode.
  - Add/remove videos from playlists (`/api/youtube/add-to-playlist`, `/api/youtube/remove-from-playlist`).
  - Create playlist from UI (`/api/youtube/create-playlist`).
- **Rules**
  - Create rule (field + match type + target playlist).
  - List/delete rules.
  - Run matching engine (`/api/run`) over recent videos.
- **Quota usage** (`/dashboard/quota`)
  - View estimated usage grouped by bucket date, operation, and channel.
  - Unassigned usage is shown as `Unassigned`; estimates are observational and not authoritative Google quota usage.

---

## CLI (`npm run cli:video-metadata -- ...`)

CLI prints JSON envelopes on stdout (`{ ok: true|false, ... }`) and uses non-zero exit on failure.

### Auth commands

```bash
npm run cli:video-metadata -- auth login
npm run cli:video-metadata -- auth login --device
npm run cli:video-metadata -- auth whoami
npm run cli:video-metadata -- auth list-users
npm run cli:video-metadata -- auth select-user --userId <USER_ID>
npm run cli:video-metadata -- auth list-channels
npm run cli:video-metadata -- auth select-channel --channelId <UC...>
npm run cli:video-metadata -- auth logout
npm run cli:video-metadata -- auth revoke [--userId <USER_ID>]
```

### Metadata commands

```bash
npm run cli:video-metadata -- list [--channelId <CHANNEL_ID>] [--maxResults 25] [--userId <USER_ID>]
npm run cli:video-metadata -- transcript --videoId <VIDEO_ID> [--userId <USER_ID>]
npm run cli:video-metadata -- preview --videoId <VIDEO_ID> --editorialPrompt "..." [--userId <USER_ID>]
npm run cli:video-metadata -- apply --videoId <VIDEO_ID> --finalTitle "..." --description "..." --expectedChannelId <UC...> [--dryRun] [--userId <USER_ID>]
```

### Playlist commands

```bash
npm run cli:video-metadata -- playlist list [--userId <USER_ID>]
npm run cli:video-metadata -- playlist create --title "..." --expectedChannelId <UC...> [--description "..."] [--privacyStatus private|public|unlisted] [--userId <USER_ID>]
npm run cli:video-metadata -- playlist update --playlistId <PLAYLIST_ID> --expectedChannelId <UC...> [--title "..."] [--description "..."] [--privacyStatus private|public|unlisted] [--userId <USER_ID>]
npm run cli:video-metadata -- playlist delete --playlistId <PLAYLIST_ID> --expectedChannelId <UC...> [--userId <USER_ID>]
npm run cli:video-metadata -- playlist add --playlistId <PLAYLIST_ID> --videoIds <VIDEO1,VIDEO2,...> [--userId <USER_ID>]
npm run cli:video-metadata -- playlist remove --playlistId <PLAYLIST_ID> --videoIds <VIDEO1,VIDEO2,...> [--userId <USER_ID>]
```

### Standalone quota reporting (not wired into the video-metadata CLI)

Run `node --import tsx src/cli/quota.ts usage [--bucketStart YYYY-MM-DD] [--operation <OPERATION>] [--operationId <ID>] [--channelId all|null|<CHANNEL_ID>]` after selecting an active authenticated user. The command prints one JSON envelope (`{ "ok": true, "data": { "summaries": [...], "estimateNotice": "..." } }` or `{ "ok": false, "error": { "code": "...", "message": "..." } }`) and exits nonzero on error. Omit `channelId` or pass `all` to include all channels, pass `null` for unassigned usage, or pass a non-empty ID containing only letters, digits, `_`, and `-`. Results are read-only, user-scoped recorded estimates, not an authoritative Google quota balance.

---

## MCP server (`npm run mcp:video-metadata`)

Starts stdio MCP server with tools for auth context + metadata + playlists.

Important: MCP server does **not** expose login flow. Authenticate first using CLI (`auth login`).

Key MCP tools:

- Context/auth tools:
  - `write_context`
  - `write_channel_list`
  - `write_channel_select`
  - `whoami`
  - `auth_user_select`
- Metadata tools:
  - `list`, `transcript`, `preview`, `apply`
- Playlist tools:
  - `playlist_list`, `playlist_create`, `playlist_update`, `playlist_delete`
  - `playlist_add_videos`, `playlist_remove_videos`

Most tools accept optional `credentialRef`; if omitted, server falls back to active local auth context.

The standalone `quotaUsage` handler in `src/mcp/quota.ts` is **not registered** as an MCP server tool. Direct integrations may pass `bucketStart`, `operation`, `operationId`, and `channelId`. Omitted or `"all"` channel means all channels; `null` or `"null"` means unassigned; explicit IDs must match `[A-Za-z0-9_-]+`. Caller scope overrides are rejected. The handler requires the active authenticated user and returns identical JSON text and structured content with stable success/error envelopes and an explicit non-authoritative estimate notice.

---

## API Route Handlers (selected)

All routes are App Router handlers and require authenticated session user.

### Metadata API

- `POST /api/video-metadata/transcript`
  - body: `{ "videoId": "..." }`
- `POST /api/video-metadata/preview`
  - body: `{ "videoId": "...", "editorialPrompt": "..." }`
- `POST /api/video-metadata/apply`
  - body: `{ "videoId": "...", "finalTitle": "...", "description": "...", "expectedChannelId": "UC...", "dryRun": true|false }`

### Quota usage API

- `GET /api/quota/usage`
  - Optional filters: `bucketStart=YYYY-MM-DD`, `operation`, `operationId`, and `channelId`.
  - Omit `channelId` or use `channelId=all` for all channels; use `channelId=null` or `channelId=unassigned` for unassigned usage.
  - Explicit channel IDs must be non-empty and contain only letters, numbers, `_`, or `-`.
  - Results always use the authenticated session user; scope overrides are rejected.
  - Values are estimated recorded usage, not authoritative remaining YouTube quota.

### YouTube Analytics summary API

- `GET /api/youtube/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` requires a session user and Google authorization with `yt-analytics.readonly` scope. Dates must span 1–31 UTC calendar days, without future dates.
- Queries the authenticated user's channel (`channel==MINE`) by `day`, with fixed metrics `views,likes,comments,estimatedMinutesWatched`; caller-supplied `channelId` is rejected, even when empty. A successful response is `{ "kind": "analytics-summary", "startDate": "...", "endDate": "...", "days": [...] }`; no data returns `"days": []`.
- Errors use `{ "kind": "analytics-summary-error", "code": "...", "message": "..." }`: 401 `AUTH_REQUIRED`, 403 `AUTH_SCOPE_INSUFFICIENT` (includes `requiredScopes: ["yt-analytics.readonly"]` and reauthorization guidance), 422 `INVALID_INPUT`, or 502 `ANALYTICS_API_ERROR`. Unexpected failures return a sanitized 500; provider details are never exposed.

### Playlist / video API used by UI

- `GET /api/youtube/videos`
- `GET /api/youtube/playlists`
- `POST /api/youtube/create-playlist`
- `POST /api/youtube/add-to-playlist`
- `POST /api/youtube/remove-from-playlist`
- `GET /api/youtube/channel-info`
- `GET|POST|DELETE /api/rules`
- `POST /api/run`

-> Next: [docs/troubleshooting.md](./troubleshooting.md)

<- [Back to README](../README.md)
