# Social video publishing and scheduling (X, Instagram, TikTok)

Objective: publish videos now or at a scheduled time to X, Instagram and TikTok from the local app, with per-post preview and confirmation. Branch/tracker: `feature/social-publishing` (from `feature-2` @ dd8e35e). Delivery: `feature-branch-chain` (cached from the previous feature). Test runner: `node --import tsx --test <file>`; suite `npm test` (collects `*.test.ts` only).

## Specs

- **S1** — User requests (verbatim): "quiero que agregues la posibilidad de meter X, instagram y tiktok para poder publicar y tambien schedule de videos" and "necesito poder publicar y temporizar videos en x instagram y tiktok please". Scope: publish videos and schedule (timed publishing) on X, Instagram and TikTok.
- **S2** — Runtime: the app runs on the user's machine (user choice: "En mi máquina (local)"). No hosting is assumed.
- **S3** — Missed posts (user choice: "Nunca publicar tarde"): "Si se pasó la hora, la marca como \"vencida\" y no la publica hasta que usted la reprograme." Assumption: a post counts as missed when the worker first sees it more than 5 minutes after its scheduled time, so normal polling delay does not mark posts missed.
- **S4** — Human confirmation per post: preview, then explicit confirmation bound to the staged file, platform, account, caption and scheduled time (HMAC confirmation token pattern from `src/lib/video-scheduling/services.ts`). No autonomous publishing (roadmap rule). "Publish now" is a confirmed post scheduled at the current time.
- **S5** — Accounts: the user connects one account per platform through that platform's OAuth with their own developer app credentials. Third-party tokens are encrypted at rest (design decision: AES-256-GCM with a key derived from `NEXTAUTH_SECRET`; existing Google tokens are untouched).
- **S6** — Video source: a file already staged through the existing staging flow (`VIDEO_UPLOAD_STAGING_ROOT`, referenced by `stagingFile`), uploaded directly to each platform (no public URL needed).
- **S7** — Platform rules (verified 2026-10-21; see L4): X — chunked media upload + create post, pay-per-use ($0.015 per post, $0.20 with a URL). TikTok — Direct Post with `creator_info` first, privacy chosen from the creator's allowed options; unaudited apps can only post `SELF_ONLY` (private) and the UI must say so. Instagram — Reels via resumable upload from the local file; requires a professional (Business/Creator) account.
- **S8** — Post states: `draft` → `scheduled` → `publishing` → `published` | `failed` | `missed` | `cancelled`. A scheduled post can be cancelled or rescheduled; a missed post can be rescheduled. A failed publish is not retried automatically (precedent: scheduling `retryAutomatically:false`).
- **S9** — Worker: starts inside the app (Next `instrumentation.ts` `register()`, Node.js runtime only, single instance per process even with dev reloads), claims each due post atomically so it is published at most once, and applies S3.
- **S10** — UI: a dashboard "Social" page to connect/disconnect accounts, compose (staged video, caption, platforms, date/time + timezone), preview, confirm, and see the queue with status, cancel and reschedule.
- **S11** — Docs: per-platform setup guide (developer app, scopes, redirect URI, costs/limits). Whether Meta and TikTok accept `localhost` redirect URIs is unverified (L4); document an HTTPS tunnel fallback for the one-time account connection.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|----|-------|------|-------|------|--------|--------|
| T1 | S5, S8 | Token encryption helper + `social_accounts` / `social_posts` tables | delegated (context backstop) | high: stored data, credentials | pending | |
| T2 | S3, S4, S8 | Post queue service: draft, preview, confirm (HMAC), cancel, reschedule, list | delegated | high: data mutations | pending | |
| T3 | S3, S9 | In-app worker: instrumentation, atomic claim, missed policy, dispatch | delegated | high: concurrency | pending | |
| T4 | S5, S7 | X: OAuth connect routes + publish adapter | delegated (parallel with T5, T6) | high: credentials | pending | |
| T5 | S5, S7 | TikTok: OAuth connect routes + publish adapter | delegated (parallel) | high: credentials | pending | |
| T6 | S5, S7 | Instagram: OAuth connect routes + resumable publish adapter | delegated (parallel) | high: credentials | pending | |
| T7 | S10 | Social dashboard page | delegated | medium | pending | |
| T8 | S11 | Setup docs per platform | delegated with T7 | passive | pending | |

Dependencies: T1 first; then T2 and T4-T6 (adapters depend on T1 contracts); T3 after T2; T7/T8 after T2. Files owned by `feat/issue-89-scheduling-ui` (Eloy, unmerged) are not edited: `src/lib/video-scheduling/*`, `src/components/dashboard-upload-form.tsx`, `src/app/api/youtube/schedule/*` (import of `toUnambiguousUtc` only).

Verification: high-risk units get writer self-verification plus one independent verifier at the feature's end (and per unit when a smaller model writes). Forecast: ~3500 authored changed lines → one child PR per task under the tracker.

## Log

- **L1** (2026-10-20, user, verbatim): "te pido algo, quiero que agregues la posibilidad de meter X, instagram y tiktok para poder publicar y tambien schedule de videos. Viendo los mejores momentos para hacerlo segun tu audiencia y todo" — best times delivered first (#111, #116).
- **L2** (2026-10-21, user, verbatim): "necesito poder publicar y temporizar videos en x instagram y tiktok please" (overrides the just-chosen CI/security option, which stays pending).
- **L3** (2026-10-21, user choices): runtime "En mi máquina (local)"; missed policy "Nunca publicar tarde".
- **L4** (2026-10-21, evidence): no native publish-at on any of the three APIs (research, assumption-level for X/IG/TikTok scheduling). Verified via web search: X pay-per-use $0.015/post (https://docs.x.com/x-api/getting-started/pricing); Instagram resumable upload from local files (https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads); TikTok unaudited Direct Post = 5 users/24h, private accounts, `SELF_ONLY` (https://developers.tiktok.com/docs/en/content-sharing-guidelines). Localhost redirect support for Meta/TikTok: conflicting sources, unverified.
- **L5** (2026-10-21, evidence): DB uses raw `CREATE TABLE IF NOT EXISTS` in `initializeDatabase()` (`src/lib/db.ts:40-89`) behind an init-gating Proxy; Google tokens plaintext; no encryption helper; staged files referenced by `stagingFile` (`src/lib/video-upload/adapter.ts:10`); no `instrumentation.ts` yet; Next docs: `register()` once per server instance, gate on `NEXT_RUNTIME === "nodejs"`.
