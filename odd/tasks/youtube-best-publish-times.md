# YouTube best publish times

Objective: recommend the best weekday/hour slots to publish on YouTube from the channel's own history. Branch: `feat/best-publish-times` (from `origin/feature-2` @ 417d622). Delivery: ask-on-risk (chain strategy asked before PR creation). Test runner: `node --import tsx --test <file>`; suite `npm test` (only collects `*.test.ts`).

## Specs

- **S1** — User request (verbatim, Spanish): "schedule de videos. Viendo los mejores momentos para hacerlo segun tu audiencia y todo". Scope chosen by the user for this feature: "Mejores horarios (YouTube)". X, Instagram and TikTok publishing are out of scope for this feature.
- **S2** — Read-only. The feature never uploads, schedules, publishes, or mutates channel data (roadmap rule: "No autonomous publishing").
- **S3** — Data source (assumption, documented): YouTube Analytics API does not expose "when your viewers are on YouTube". The recommendation is derived from the channel's own history: for each recent video, its real publish time (`videos.list` `snippet.publishedAt`) and its early views (Analytics `reports.query`, `filters=video==<id>`, publish date through publish date + 2 days, Pacific-time report days).
- **S4** — Videos whose early window is not yet complete (published less than 4 days ago) are excluded. The analysis uses at most the 50 most recent uploads.
- **S5** — Slots are computed in the timezone the client sends (IANA, validated); a slot is weekday x 3-hour block. Each slot score is the median of its videos' early views divided by the channel's overall median early views. Slots with fewer than 2 videos are not recommended.
- **S6** — The response returns the top slots (up to 3) with weekday, block start/end hour, score, sample size, and an overall confidence (`low` when fewer than 10 videos were analyzed or no slot has 2+ videos), plus the number of videos analyzed and excluded.
- **S7** — Requires the `yt-analytics.readonly` scope, with the same error contract as the existing analytics summary: `AUTH_REQUIRED` 401, `AUTH_SCOPE_INSUFFICIENT` 403, `INVALID_INPUT` 422, `ANALYTICS_API_ERROR` 502.
- **S8** — Exposed as `GET /api/youtube/best-publish-times?timezone=<IANA>` and as a dashboard panel next to the analytics summary that explains the method and its limits.

## Tasks

| ID | Specs | Task | Route | Status | Commit |
|----|-------|------|-------|--------|--------|
| T1 | S3, S4 | Adapter: video publish times + per-video early views | inline | pending | |
| T2 | S2, S4, S5, S6, S7 | Service: slot bucketing, scoring, confidence, error contract | inline | pending | |
| T3 | S7, S8 | API route `GET /api/youtube/best-publish-times` | inline | pending | |
| T4 | S6, S8 | Dashboard panel + docs | inline | pending | |

Route evidence: no Writer trigger (tasks are sequential and depend on each other); inline. Risk tier: medium (new read-only endpoint, no stored data, existing scope) — writer self-verification, no independent verifier.

Forecast: ~700 authored changed lines (exceeds ~400) → chain strategy to be asked once before creating any PR.

## Log

- **L1** (2026-10-20, user, verbatim): "te pido algo, quiero que agregues la posibilidad de meter X, instagram y tiktok para poder publicar y tambien schedule de videos. Viendo los mejores momentos para hacerlo segun tu audiencia y todo"
- **L2** (2026-10-20, user choice): "Mejores horarios (YouTube)" — start with best times; other platforms deferred.
- **L3** (2026-10-20, evidence): exploration mapped `src/lib/youtube-analytics-summary/` (adapter with `channel==MINE`, no per-video filter yet), route error mapping, `listVideosByChannel` uses playlistItems `publishedAt` (not reliable for real publish time → use `videos.list`). `feat/issue-89-scheduling-ui` (Eloy, unmerged) owns scheduling UI; this feature does not touch `dashboard-upload-form.tsx` to avoid conflicts. Pre-existing: `npm test` skips `*.test.tsx`.
