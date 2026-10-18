# TubeMaster Getting Started (zero → working)

<- [Back to README](../README.md)

TubeMaster is a channel-operations workspace spanning **Web UI, CLI, MCP, and API** surfaces. This guide gets you from a fresh machine to a working local setup; each interface exposes a different subset of channel workflows.

## What you can do now

| Surface | First workflows |
| --- | --- |
| Web UI | Browse, select, and export loaded videos; manage playlists and rules; view estimated quota usage |
| CLI | Set channel context; list videos, acquire transcripts, preview or guarded-apply metadata, and manage playlists |
| MCP | Use context, metadata, transcript, and playlist tools after CLI login; no MCP login or registered quota tool |
| API | Use authenticated route handlers for video/playlist/rule workflows, metadata/transcripts, and quota estimates |

See [interface details](./interfaces.md) for exact commands and boundaries. Audit events are best-effort service logs, not an audit database. The authenticated analytics dashboard supports 7/30/90-day presets, custom ranges up to 90 days, daily metrics, and local CSV export. Expanded analytics/reporting and future metadata, transcript, and search increments remain roadmap work; there is no autonomous publishing or one-release promise.

## Prerequisites

- Node.js `>=20.9.0` (required by Next.js 16.2.2)
- npm (bundled with Node.js)

## 1) Google Cloud Console setup

TubeMaster uses Google OAuth, YouTube Data API v3, and YouTube Analytics API v2. Enable both Google APIs and configure the OAuth consent screen before starting the app.

### 1.1 Create or select a Google Cloud project

1. Open Google Cloud Console.
2. Create a new project (or use an existing one for TubeMaster).
3. Keep this project selected for the next steps.

### 1.2 Enable Google APIs

1. Go to **APIs & Services → Library**.
2. Search for and enable **YouTube Data API v3**.
3. Search for and enable **YouTube Analytics API** (`youtubeanalytics.googleapis.com`).
4. Confirm both APIs are enabled in the same Google Cloud project used by the OAuth client.

> The dashboard's analytics requests return `403 accessNotConfigured` when YouTube Analytics API is disabled. After enabling it, Google may need a few minutes to propagate the change before the first request succeeds.

### 1.3 Configure OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** (or Internal if your org requires it).
3. Complete required app fields.
4. Add the scopes TubeMaster requests:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/youtube`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`

> These are the default scopes requested by the app (`src/lib/auth.ts`). Existing users must re-authenticate after this scope is added; updating the consent screen alone does not upgrade their grants.

### 1.4 Create OAuth client credentials

Create **OAuth client ID** of type **Web application**.

Add these redirect URIs:

- `http://localhost:3102/api/auth/callback/google` (Web UI / NextAuth callback)
- `http://127.0.0.1:8787` (CLI loopback login callback)

If you change `CLI_OAUTH_CALLBACK_PORT`, update the second URI to match the new port.

Then copy:

- **Client ID**
- **Client Secret**

You will map them in `.env.local` in the next step.

---

## 2) Local environment (`.env.local`)

Create `.env.local` in project root:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
NEXTAUTH_URL=http://localhost:3102
NEXTAUTH_SECRET=replace-with-a-long-random-secret

# Optional
# CLI_OAUTH_CALLBACK_PORT=8787
# YOUTUBE_TRANSCRIPT_PROVIDER=youtube-captions
# METADATA_GENERATOR_MODE=rule-based
# METADATA_GENERATOR_RAW_OUTPUT={"finalTitle":"...","description":"...","promptVersion":"..."}
```

Required variables are used by:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` → OAuth client for Web + CLI + MCP (`src/lib/auth.ts`)
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET` → NextAuth session/auth flow (web routes)

---

## 3) Install and run

```bash
npm ci
npm run dev
```

The development server always uses port `3102` so the OAuth callback remains stable. App URL: `http://localhost:3102`.

---

## 4) First auth + context check (recommended)

Even if you will use Web UI, validating auth with CLI gives you fast feedback.

### 4.1 Login

Loopback OAuth (opens browser):

```bash
npm run cli:video-metadata -- auth login
```

Device flow alternative:

```bash
npm run cli:video-metadata -- auth login --device
```

### 4.2 Verify active identity

```bash
npm run cli:video-metadata -- auth whoami
```

### 4.3 Set expected write channel (safety)

For guarded write operations, define the channel context:

```bash
npm run cli:video-metadata -- auth list-channels
npm run cli:video-metadata -- auth select-channel --channelId <UC...>
```

This persists local selection and helps satisfy write guardrails for sensitive operations.

---

## 5) Run first useful commands

```bash
# Read-only check
npm run cli:video-metadata -- playlist list

# Safe metadata review (no mutation)
npm run cli:video-metadata -- apply --videoId <VIDEO_ID> --finalTitle "Draft title" --description "Draft description" --expectedChannelId <UC...> --dryRun
```

When `--dryRun` is present, TubeMaster returns the proposed metadata without calling the write mutation.

---

## 6) Where local state is stored

- `data/playlist-manager.db` → local SQLite database for users, tokens, rule data, and selected channel. The filename is legacy; TubeMaster now covers broader channel operations.
- `data/auth-context.json` → active local auth user for CLI/MCP fallback

---

## Common setup pitfalls

- **OAuth redirect mismatch** → verify the Web UI callback is exactly `http://localhost:3102/api/auth/callback/google`, the CLI callback is exactly `http://127.0.0.1:8787`, and `.env.local` uses `NEXTAUTH_URL=http://localhost:3102`.
- **Scope-related errors** (`AUTH_SCOPE_INSUFFICIENT`) → for core workflows, check the default YouTube scopes (`youtube.readonly`, `youtube`, `youtube.force-ssl`) and re-authenticate. For the optional analytics summary API, the authenticated grant must also include `https://www.googleapis.com/auth/yt-analytics.readonly`; add it to the authorization request and re-authenticate existing users.
- **No active auth context** (`AUTH_USER_NOT_FOUND`) → run `auth login` and retry.
- **Write guardrail failures** (`WRITE_CHANNEL_*`) → set/select expected channel and ensure OAuth account matches it.

For full error mapping and fixes: [docs/troubleshooting.md](./troubleshooting.md)

-> Next: [docs/interfaces.md](./interfaces.md) for Web UI, CLI, MCP, and API usage details.

<- [Back to README](../README.md)
