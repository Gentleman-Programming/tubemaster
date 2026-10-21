# UI redesign (gentlemanprogramming.com style) + scheduling UX

Objective: restyle the whole TubeMaster interface with the gentlemanprogramming.com design language and add UX improvements, starting with a calendar to pick when to post and to see every scheduled item. Branch/tracker: `feature/ui-redesign` (from `feature-2`). Delivery: `feature-branch-chain` (cached). Test runner: `node --import tsx --test <file>`; `npm test` collects `*.test.ts` only (run `*.test.tsx` directly).

## Specs

- **S1** — User request (verbatim): "puedes ver la app de tubemaster y mejorar toda la interfaz siguiendo el diseño de gentlemanprogramming.com ademas" + "de mejoras a nivel ux? por ejemplo un calendar para elegir cuando postear" + "y ver todas las planificaciones".
- **S2** — Design tokens extracted from gentlemanprogramming.com CSS (2026-10-21, `/_astro/business.*.css`, `/_astro/telemetry.*.css`): dark plum terminal aesthetic. Base `#1a1218` (theme-color), surfaces `#20161e` / `#241822` / `#342230`, panel black `#000`; text `#f6eff3`, subtext `#a78e9b` / `#76616b`, dim `#b99aa9`; accents rose `#f095c8`, pink `#ffb1dd`, hot rose `#ff76c3`, sky `#a9c7ee`, mint `#b4e7c7`, peach `#f2b86d`, red `#ff718f`, yellow `#e0c27a`, mauve `#d7a0b8`; borders `#ffffff17`, soft `#ffffff0f`; translucent surfaces `#ffffff07` / `#ffffff0d`. Fonts: sans "Inter", mono "IosevkaTerm NF"/"Iosevka Term"/"JetBrains Mono" (body text on the site is mono 13px/1.5). Radius small 8px, medium 12px, large 16px, full 999px. Shadows: `0 30px 60px #00000059, 0 0 40px #f095c81a` (glow), primary button glow `0 8px 20px #f095c847`. Layout cues: sidebar 280px, tab bar 40px, footer 52px; buttons `btn-primary` / `btn-secondary`.
- **S3** — Restyle every user-facing page and component (landing/login, dashboard shell + sidebar + header, analytics, best publish times, transcripts, manual mode/rules, quota, social pages) using shared tokens and primitives; keep all copy, roles, ARIA and behavior unchanged except where a UX spec changes them. Fix the `globals.css` Arial override so the chosen fonts apply. Dark-only.
- **S4** — Calendar to pick when to post (user: "un calendar para elegir cuando postear"): a date/time picker (month grid + time selection + timezone) replaces the raw date/time inputs in the social composer and reschedule flows; it highlights the recommended best publish slots when available.
- **S5** — See all schedules (user: "ver todas las planificaciones"): a calendar page (month and week views) showing social posts (all statuses with colors) and YouTube videos scheduled with a publish time, read-only for YouTube; clicking a social item shows details with reschedule/cancel through the existing confirmation flow; clicking an empty future slot opens the composer prefilled with that time.
- **S6** — Files owned by the unmerged `feat/issue-89-scheduling-ui` branch are not edited: `src/components/dashboard-upload-form.tsx`, `src/lib/video-scheduling/*`, `src/app/api/youtube/schedule/*` (restyle the upload form after that branch merges).

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|----|-------|------|-------|------|--------|--------|
| T1 | S2, S3 | Tokens + fonts (`globals.css` @theme, Inter + JetBrains Mono, Arial fix) + `cn` helper + UI primitives (Button, Card, Badge, Input/Select, SectionHeader, EmptyState) with tests | delegated (context backstop) | medium | pending | |
| T2 | S3 | Shell: landing/login, dashboard layout, sidebar, header | delegated | medium | pending | |
| T3 | S3 | Panels: analytics, best publish times, transcripts, quota, manual mode + rules (remove legacy light/dark classes) | delegated (parallel with T4) | medium | pending | |
| T4 | S3 | Social pages restyle (accounts, composer, queue) | delegated (parallel with T3) | medium | pending | |
| T5 | S4 | Date/time picker with best-slot highlights in composer + reschedule | delegated | medium | pending | |
| T6 | S5 | Schedules calendar page: API for scheduled YouTube videos (read-only) + month/week views + item actions | delegated | medium | pending | |
| T7 | S1-S5 | Visual check in the browser (ego lite) of every page + fixes | parent + worker | passive | pending | |

## Log

- **L1** (2026-10-21, user, verbatim): "puedes ver la app de tubemaster y mejorar toda la interfaz siguiendo el diseño de gentlemanprogramming.com ademas" / "de mejoras a nivel ux? por ejemplo un calendar para elegir cuando postear" / "y ver todas las planificaciones".
- **L2** (2026-10-21, evidence): UI map — all styling is inline Tailwind, no `cn` or primitives; `globals.css` is the create-next-app default and sets `font-family: Arial` on body (overrides Geist); `<html class="dark">` forced; repeated card pattern `rounded-xl border border-zinc-800 bg-zinc-950/40 p-5` (analytics-dashboard.tsx:179, best-publish-times-panel.tsx:120, social-accounts-panel.tsx:146, social-queue.tsx:226, dashboard/social/page.tsx:34); legacy light+`dark:` classes in rule-form.tsx, rule-list.tsx, run-button.tsx; component tests assert text/ARIA only (no class assertions).
