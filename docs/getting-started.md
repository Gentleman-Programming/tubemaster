# TubeMaster Getting Started (zero → working)

<- [Back to README](../README.md)

This guide gets you from a fresh machine to a working TubeMaster setup for **Web UI + CLI + MCP** channel operations.

## 1) Google Cloud Console setup

TubeMaster uses Google OAuth + YouTube Data API v3. You must configure both.

### 1.1 Create or select a Google Cloud project

1. Open Google Cloud Console.
2. Create a new project (or use an existing one for TubeMaster).
3. Keep this project selected for the next steps.

### 1.2 Enable YouTube Data API v3

1. Go to **APIs & Services → Library**.
2. Enable **YouTube Data API v3**.

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

> These scopes are enforced by the app (`src/lib/auth.ts`).
> If you add a new scope to an existing OAuth client, previously authorized users must re-authenticate to grant it.

### 1.4 Create OAuth client credentials

Create **OAuth client ID** of type **Web application**.

Add these redirect URIs:

- `http://localhost:3000/api/auth/callback/google` (Web UI / NextAuth callback)
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
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-a-long-random-secret

# Optional
# CLI_OAUTH_CALLBACK_PORT=8787
# CLI_OAUTH_OPENER_DEBUG=1
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
npm install
npm run dev
```

App should be available at `http://localhost:3000`.

---

## 4) First auth + context check (recommended)

Even if you will use Web UI, validating auth with CLI gives you fast feedback.

### 4.1 Login

Loopback OAuth (opens browser):

```bash
npm run cli:video-metadata -- auth login
```

On Windows, CLI login opens the OAuth URL with `rundll32.exe url.dll,FileProtocolHandler <url>`. If the browser does not open, copy the printed OAuth URL from the console and open it manually; the URL is intentionally kept visible as a fallback login path.

For maintainer diagnostics, run the same command with `CLI_OAUTH_OPENER_DEBUG=1` to print opener command, process, and lifecycle details to stderr.

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

- **OAuth redirect mismatch** → verify both redirect URIs exactly.
- **Scope-related errors** (`AUTH_SCOPE_INSUFFICIENT`) → include all TubeMaster YouTube scopes (`youtube.readonly`, `youtube`, `youtube.force-ssl`) in consent/client, then revoke or logout and re-auth.
- **No active auth context** (`AUTH_USER_NOT_FOUND`) → run `auth login` and retry.
- **Write guardrail failures** (`WRITE_CHANNEL_*`) → set/select expected channel and ensure OAuth account matches it.

For full error mapping and fixes: [docs/troubleshooting.md](./troubleshooting.md)

-> Next: [docs/interfaces.md](./interfaces.md) for Web UI, CLI, MCP, and API usage details.

<- [Back to README](../README.md)
