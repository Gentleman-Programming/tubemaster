# TubeMaster — YouTube Channel Operations Workspace

![TubeMaster banner](docs/assets/tubemaster-banner.png)

TubeMaster is a **channel-operations workspace** spanning Web UI, CLI, MCP, and API surfaces. It supports channel context, video browsing and selection/export, playlist operations, rules, metadata preview and guarded apply, transcript acquisition, quota visibility, and observational audit events. Each interface exposes a different subset; see [interface boundaries](docs/interfaces.md).

<p>
  <img src="docs/assets/tubemaster.png" alt="TubeMaster logo" width="140" />
  <img src="docs/assets/tubemaster-lite.png" alt="TubeMaster light logo" width="140" />
</p>

## Start here (from zero to working app)

1. **Configure Google Cloud OAuth + YouTube API**
   - Follow: [docs/getting-started.md#1-google-cloud-console-setup](docs/getting-started.md#1-google-cloud-console-setup)
2. **Create `.env.local`** with required credentials
   - Follow: [docs/getting-started.md#2-local-environment-envlocal](docs/getting-started.md#2-local-environment-envlocal)
3. **Install and run locally**
   - `npm install`
   - `npm run dev`
4. **Authenticate and verify access** (CLI recommended first)
   - `npm run cli:video-metadata -- auth login`
   - `npm run cli:video-metadata -- auth whoami`

Full walkthrough: **[docs/getting-started.md](docs/getting-started.md)**. The development server uses port `3102` so the OAuth callback remains stable.

## Interfaces

| Interface | Entry point | Current scope |
| --- | --- | --- |
| Web UI | `http://localhost:3102` | Browse/select/export videos, playlist actions, rules, estimated quota usage, read-only best publish times panel, social publishing to Instagram and TikTok (preview + confirm, scheduling) |
| CLI | `npm run cli:video-metadata -- <command>` | Auth/channel context, metadata and transcript workflows, playlists, guarded `upload multi|reconcile|reconcile-many|cancel`, read-only `best-times --timezone <IANA>`; quota has a separate command |
| MCP Server (stdio) | `npm run mcp:video-metadata` | Context, metadata, transcripts, playlists, guarded `upload_multi|upload_reconcile|upload_reconcile_many|upload_cancel`, read-only `best_publish_times` (`timezone` required), Instagram/TikTok publishing (`social_*`: stage → preview → human approval → confirm; [guide](docs/social-publishing.md#using-it-from-mcp)); no login or registered quota tool |
| API Route Handlers | `/api/youtube/videos`, `/api/video-metadata/*`, `/api/youtube/best-publish-times` | Session-authenticated UI operations, metadata/transcripts, estimated quota usage |

Detailed usage by interface: **[docs/interfaces.md](docs/interfaces.md)**

## Roadmap boundary

An authenticated analytics summary API (`GET /api/youtube/analytics`) and local selected-video JSON/CSV export already exist. The optional analytics API requires an OAuth grant with `https://www.googleapis.com/auth/yt-analytics.readonly`, which default core login scopes omit; existing users must re-authenticate after adding it to the authorization request. See [analytics setup](docs/getting-started.md#13-configure-oauth-consent-screen). Expanded analytics/reporting, future metadata/transcript improvements, and search are separate roadmap increments—not capabilities promised in one release. TubeMaster does not autonomously publish content.

## Operation audit events

Metadata, transcript, and playlist services emit privacy-filtered lifecycle events to the configured logger. Events are observational: logger failures do not change API results. The default metadata logger writes JSON lines to stderr; playlist events require an injected logger. No audit database or built-in retention policy is provided in this slice; stderr retention depends on your process/log collector. See [event vocabulary and fields](docs/interfaces.md#operation-audit-events).

## Quick command examples

```bash
npm run dev
npm run test
npm run lint
```

### CLI examples

```bash
# Playlist operations
npm run cli:video-metadata -- playlist create --title "Roadtrip 2026" --description "Videos del viaje" --expectedChannelId <CHANNEL_ID> --confirmed --privacyStatus unlisted
npm run cli:video-metadata -- playlist update --playlistId <PLAYLIST_ID> --expectedChannelId <CHANNEL_ID> --confirmed --description "Nueva descripción"
npm run cli:video-metadata -- playlist add --playlistId <PLAYLIST_ID> --videoIds <VIDEO_ID_1>,<VIDEO_ID_2> --expectedChannelId <CHANNEL_ID> --confirmed

# Metadata operations
npm run cli:video-metadata -- transcript --videoId <VIDEO_ID>
npm run cli:video-metadata -- preview --videoId <VIDEO_ID> --editorialPrompt "Hacé un título claro"
npm run cli:video-metadata -- apply --videoId <VIDEO_ID> --finalTitle "Nuevo título" --description "Nueva descripción" --expectedChannelId <CHANNEL_ID> --dryRun

# Upload recovery: staged multi-video private preview, then explicit confirmation
npm run cli:video-metadata -- upload multi --expectedChannelId <CHANNEL_ID> --items '[{"stagingFile":"video.mp4","title":"Video"}]' --dryRun
npm run cli:video-metadata -- upload multi --expectedChannelId <CHANNEL_ID> --items '[{"stagingFile":"video.mp4","title":"Video"}]' --confirmed --confirmationToken <TOKEN>
npm run cli:video-metadata -- upload reconcile --operationId <OPERATION_ID> --videoId <VIDEO_ID> --expectedChannelId <CHANNEL_ID>
npm run cli:video-metadata -- upload reconcile-many --expectedChannelId <CHANNEL_ID> --items '[{"operationId":"<OPERATION_ID>","videoId":"<VIDEO_ID>"}]'
npm run cli:video-metadata -- upload cancel --operationId <OPERATION_ID> --videoId <VIDEO_ID> --expectedChannelId <CHANNEL_ID> --dryRun
npm run cli:video-metadata -- upload cancel --operationId <OPERATION_ID> --videoId <VIDEO_ID> --expectedChannelId <CHANNEL_ID> --confirmed --confirmationToken <TOKEN>

# Read-only best publish times estimate (needs yt-analytics.readonly)
npm run cli:video-metadata -- best-times --timezone America/Argentina/Buenos_Aires
```

## Environment Variables

### Required

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

See full env setup + Google credentials mapping: **[docs/getting-started.md#2-local-environment-envlocal](docs/getting-started.md#2-local-environment-envlocal)**

### Optional

- `YOUTUBE_TRANSCRIPT_PROVIDER` (`youtube-captions` by default)
- `METADATA_GENERATOR_MODE` (`rule-based` by default, `raw-json` for strict output checks)
- `METADATA_GENERATOR_RAW_OUTPUT` (used only when mode is `raw-json`)
- `CLI_OAUTH_CALLBACK_PORT` (`8787` by default; if changed, update OAuth redirect URI accordingly)

## Contracts and Safety Guarantees

- **Stable JSON envelopes** across CLI/MCP/core with typed errors and non-zero exit status on failures.
- **Strict credential precedence**: explicit `credentialRef` → active local context (`data/auth-context.json`) → typed auth error.
- **Fail-closed write operations** (`apply`, playlist mutations, multi-video upload execution, and return-to-private recovery) requiring `expectedChannelId` and explicit confirmation where applicable.
- **Recovery safety:** reconciliation never retries a mutation; unknown and unsupported provider outcomes remain explicit, and return-to-private requires a dry-run preview plus matching confirmation token.
- **Safe playlist partial results**: add returns `attempted`/`added` + `failures[]`; remove returns `requested`/`removed` + `failures[]`.
- **Transcript compatibility contract** with stable `status` and additive diagnostics.

Troubleshooting these guardrails and auth errors: **[docs/troubleshooting.md](docs/troubleshooting.md)**

## Documentation

- **Roadmap and future Shorts proposal:** [docs/roadmap.md](docs/roadmap.md)
- **Getting started (Google Cloud + local setup):** [docs/getting-started.md](docs/getting-started.md)
- **Web UI, CLI, MCP, API usage:** [docs/interfaces.md](docs/interfaces.md)
- **Social publishing setup (Instagram, TikTok):** [docs/social-publishing.md](docs/social-publishing.md)
- **Common auth/API/env errors and fixes:** [docs/troubleshooting.md](docs/troubleshooting.md)

## Contributing

TubeMaster is open source under the [MIT License](LICENSE).

- Open an issue for bugs, contract changes, or feature requests.
- Open a PR with focused changes and clear reproduction/validation notes.
- Keep changes backward-compatible where possible, especially for CLI/MCP JSON contracts.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, validation, and PR expectations.

If you are integrating with agents, start the MCP server with:

```bash
npm run mcp:video-metadata
```
