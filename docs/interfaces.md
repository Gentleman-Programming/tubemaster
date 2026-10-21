# TubeMaster Interfaces: Web UI, CLI, MCP, API

<- [Back to README](../README.md)

TubeMaster is a channel-operations workspace across Web UI, CLI, MCP, and API surfaces. Use this reference after [setup](./getting-started.md) to choose the wired interface for each workflow; capabilities are not identical across surfaces.

| Workflow | Wired surface |
| --- | --- |
| Channel context | CLI auth selection; MCP context tools; authenticated API channel info |
| Video browsing, selection, export | Web UI browse/select and local JSON/CSV export; CLI metadata list and MCP list; API video routes |
| Playlists | Web UI actions; CLI and MCP list/create/update/delete/add/remove; selected UI API routes |
| Rules | Web UI create/list/delete/run; `/api/rules` and `/api/run` |
| Metadata preview/apply, transcript acquisition | CLI, MCP, and metadata API; apply requires expected channel and supports dry run |
| Analytics summary | Authenticated `GET /api/youtube/analytics` with a range of up to 90 days; the dashboard offers 7/30/90-day presets, custom dates, daily totals, traffic-source breakdowns, period comparison, and local CSV export |
| Quota visibility | Web UI, separate quota CLI, and quota API; MCP quota handler is not registered |
| Operation audit events | Best-effort metadata, transcript, and playlist service logs; not a queryable audit store |

Expanded analytics/reporting and future metadata, transcript, and search increments are separate roadmap work, not one-release commitments. No autonomous publishing is wired.

## Operation audit events

Service workflows emit `start` before work and one terminal `success`, `dry_run` (metadata apply only), or `failure` event afterward. Vocabulary: `video_metadata.list`, `video_metadata.preview`, `video_metadata.apply`, `transcript.get`, and `playlist.list`, `playlist.create`, `playlist.update`, `playlist.delete`, `playlist.add_videos`, `playlist.remove_videos`, each followed by `.<phase>`. The logger writes `{ level, event, timestamp, context }` JSON lines; `timestamp` is an ISO date. Context is strictly restricted to scalar `operationId`, `channelId`, `videoId`, `playlistId`, `dryRun`, `count`, `code`, and `transcriptStatus`. Channel IDs appear only when resolved/available; operation IDs correlate lifecycle events and quota context where passed. Failure `code` is a mapped domain code, never a raw provider error. No credential, title, description, editorial prompt, transcript text, or nested payload is logged. A batch operation can succeed with per-item failures; its existing response retains those details without embedding them in audit events.

The default metadata logger streams JSON lines to stderr. Playlist events are emitted only if a logger is injected into playlist services. These events are not stored in SQLite and have no app-managed retention or query API; retention is determined by the process supervisor or log collector. Audit delivery is best-effort, not durable, and does not alter responses or block writes.

## Web UI (`http://localhost:3102`)

The local development server uses port `3102` by default. Set `NEXTAUTH_URL=http://localhost:3102` and register `http://localhost:3102/api/auth/callback/google` as the Google OAuth web callback.

### Login flow

1. Open home page.
2. Click **Sign in with Google** and grant the requested YouTube and Analytics read-only scopes.
3. On success, app redirects to `/dashboard`.
4. Existing users must sign out and sign in again after a new scope is introduced so Google can issue an updated grant.

### Dashboard tabs

- **Manual**
  - Browse your videos (`/api/youtube/videos`) or paste IDs/URLs in batch mode.
  - In Browse, load videos and select rows, then use **Export JSON** or **Export CSV**. Exports include only selected loaded videos, even when hidden by the current title search; stale selections and pasted batch IDs are excluded. Both buttons are disabled without selected loaded videos. Downloads are generated locally, read-only, without another API request: `tubemaster-selected-videos.json` (`application/json;charset=utf-8`) or `tubemaster-selected-videos.csv` (`text/csv;charset=utf-8`). Fields are `videoId`, `title`, `description`, `publishedAt` in loaded order. JSON preserves values exactly; CSV uses the same header, CRLF rows, standard quoting, and prefixes a single quote to cells whose first non-whitespace character is `=`, `+`, `-`, or `@` to reduce spreadsheet formula execution risk (so CSV may not round-trip those values exactly).
  - Add/remove videos from playlists (`/api/youtube/add-to-playlist`, `/api/youtube/remove-from-playlist`).
  - Create playlist from UI (`/api/youtube/create-playlist`).
- **Rules**
  - Create rule (field + match type + target playlist).
  - List/delete rules.
  - Run matching engine (`/api/run`) over recent videos.
- **Analytics**
  - View daily views, likes, comments, and estimated minutes watched for the last 7, 30, or 90 days, or a custom range up to 90 days.
  - Compare current totals and traffic-source views with the immediately preceding equivalent period, including absolute and percentage deltas; a zero baseline is shown as `New` rather than an invented percentage.
  - Export the displayed daily analytics rows and traffic-source breakdown as a local CSV file; comparison loading is read-only and performs no persistence or analytics write.
- **Quota usage** (`/dashboard/quota`)
  - View estimated usage grouped by bucket date, operation, and channel.
  - Unassigned usage is shown as `Unassigned`; estimates are observational and not authoritative Google quota usage.

---

## CLI (`npm run cli:video-metadata -- ...`)

CLI prints success JSON envelopes on stdout (`{ ok: true, data }`) and error JSON envelopes on stderr (`{ ok: false, error }`), with non-zero exit on failure.

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
npm run cli:video-metadata -- best-times --timezone <IANA> [--userId <USER_ID>]  # read-only estimate; needs yt-analytics.readonly
```

### Playlist commands

```bash
npm run cli:video-metadata -- playlist list [--userId <USER_ID>]
npm run cli:video-metadata -- playlist create --title "..." --expectedChannelId <UC...> --confirmed [--description "..."] [--privacyStatus private|public|unlisted] [--userId <USER_ID>]
npm run cli:video-metadata -- playlist update --playlistId <PLAYLIST_ID> --expectedChannelId <UC...> --confirmed [--title "..."] [--description "..."] [--privacyStatus private|public|unlisted] [--userId <USER_ID>]
npm run cli:video-metadata -- playlist delete --playlistId <PLAYLIST_ID> --expectedChannelId <UC...> --confirmed [--userId <USER_ID>]
npm run cli:video-metadata -- playlist add --playlistId <PLAYLIST_ID> --videoIds <VIDEO1,VIDEO2,...> --expectedChannelId <UC...> --confirmed [--userId <USER_ID>]
npm run cli:video-metadata -- playlist remove --playlistId <PLAYLIST_ID> --videoIds <VIDEO1,VIDEO2,...> --expectedChannelId <UC...> --confirmed [--userId <USER_ID>]
```

### Standalone quota reporting (not wired into the video-metadata CLI)

Run `node --import tsx src/cli/quota.ts usage [--bucketStart YYYY-MM-DD] [--operation <OPERATION>] [--operationId <ID>] [--channelId all|null|<CHANNEL_ID>]` after selecting an active authenticated user. The command prints one JSON envelope (`{ "ok": true, "data": { "summaries": [...], "estimateNotice": "..." } }` or `{ "ok": false, "error": { "code": "...", "message": "..." } }`) and exits nonzero on error. Omit `channelId` or pass `all` to include all channels, pass `null` for unassigned usage, or pass a non-empty ID containing only letters, digits, `_`, and `-`. Results are read-only, user-scoped recorded estimates, not an authoritative Google quota balance.

---

## MCP server (`npm run mcp:video-metadata`)

Starts stdio MCP server with tools for auth context + metadata + playlists + social publishing.

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
- Best publish times tool:
  - `best_publish_times` — read-only estimate from the channel's own past uploads; `timezone` (IANA) required; needs `yt-analytics.readonly`; never publishes or schedules
- Social publishing tools (Instagram/TikTok; accounts are connected once in the web app, see [Using it from MCP](./social-publishing.md#using-it-from-mcp)):
  - `social_accounts` — connected accounts (public fields only, never tokens) and platforms configured in env
  - `social_stage_video` — copies an absolute local video path (regular mp4/mov/webm/mkv file, no symlinks, size-limited) into staging; returns `stagingFile` and `size`; the source is never modified
  - `social_preview` — creates a draft and returns the preview plus a 10-minute `confirmationToken`; does not publish
  - `social_confirm` — `postId` + `confirmationToken`; schedules/publishes irreversibly; call only after the human approved the shown preview; the web app must be running for the worker to publish
  - `social_queue` — lists posts, optional `status` filter
  - `social_cancel` — cancels a draft, scheduled, failed or missed post
  - `social_reschedule` — `postId` + `schedule`; returns the post to draft with a new preview and token that need a new confirmation
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

### Analytics summary API

- `GET /api/youtube/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
  - Requires an authenticated session, a valid date range, and an OAuth grant containing `https://www.googleapis.com/auth/yt-analytics.readonly`. This optional analytics scope is not requested by the default core login scopes; without it the route returns `AUTH_SCOPE_INSUFFICIENT` (403). Add the scope to the authorization request and re-authenticate existing users to grant it. This is distinct from the Web UI's local selected-video export and does not imply analytics writes.
  - The dashboard comparison uses this same endpoint twice: once for the selected range and once for the immediately preceding equivalent range. Each request remains bounded by the existing 90-day limit; no comparison data is persisted. Responses include daily metrics and a `trafficSources` array keyed by `sourceType`.

### Best publish times API

- `GET /api/youtube/best-publish-times?timezone=<IANA>`
  - Read-only estimate of the best weekday/3-hour publish slots from the channel's own recent uploads; requires `https://www.googleapis.com/auth/yt-analytics.readonly` and never publishes or schedules anything.

### Scheduled YouTube videos API

- `GET /api/youtube/scheduled`
  - Read-only list of the session user's 50 most recent uploads that are private and have a scheduled `publishAt`: `{ kind: "youtube-scheduled-videos", videos: [{ videoId, title, publishAt, thumbnailUrl? }] }`, sorted by `publishAt`. Used by the Calendar page.
  - Requires `https://www.googleapis.com/auth/youtube.readonly`. Errors: `AUTH_REQUIRED` (401), `AUTH_SCOPE_INSUFFICIENT` (403), `YOUTUBE_API_ERROR` (502). Each call records estimated `channels.list`, `playlistItems.list` and `videos.list` quota.

### Quota usage API

- `GET /api/quota/usage`
  - Optional filters: `bucketStart=YYYY-MM-DD`, `operation`, `operationId`, and `channelId`.
  - Omit `channelId` or use `channelId=all` for all channels; use `channelId=null` or `channelId=unassigned` for unassigned usage.
  - Explicit channel IDs must be non-empty and contain only letters, numbers, `_`, or `-`.
  - Results always use the authenticated session user; scope overrides are rejected.
  - Values are estimated recorded usage, not authoritative remaining YouTube quota.

### Social publishing API

Session-authenticated; setup in [social-publishing.md](./social-publishing.md). Errors return `{ error: <CODE>, message }`.

- `GET /api/social/accounts` — connected accounts (no tokens); `DELETE /api/social/accounts?platform=<tiktok|instagram>` disconnects.
- `GET /api/social/tiktok/connect`, `GET /api/social/instagram/connect` — start OAuth (full-page navigation); callbacks redirect to `/dashboard/social?connected=<platform>` or `?error=<code>`.
- `GET /api/social/posts[?status=<status>]` — list posts.
- `POST /api/social/posts` — create a draft and return its preview plus `confirmationToken`; nothing is published.
- `GET /api/social/posts/<id>` — one post.
- `POST /api/social/posts/<id>/confirm` — `{ confirmationToken }`; schedules the draft.
- `POST /api/social/posts/<id>/reschedule` — `{ schedule }`; returns the post to draft with a new preview and token.
- `POST /api/social/posts/<id>/cancel` — cancel a draft, scheduled or missed post.

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
