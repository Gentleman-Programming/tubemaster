# Social publishing: Instagram Reels and TikTok

TubeMaster can publish a staged video to Instagram (as a Reel) and TikTok, now or at a scheduled time, from the dashboard **Social publishing** page (`/dashboard/social`). Every post is previewed and needs your explicit confirmation; nothing is posted automatically.

| Platform | Status | Cost |
| --- | --- | --- |
| Instagram Reels | Supported | Free (Graph API) |
| TikTok | Supported (private-only until your app is audited) | Free (Content Posting API) |
| X | Deferred | — |

## Quick path

1. Create a developer app for each platform you want ([TikTok](#tiktok), [Instagram](#instagram)).
2. Register the redirect URIs from [Redirect URIs](#redirect-uris) in each app.
3. Add the [environment variables](#environment-variables) to `.env.local` and restart `npm run dev`.
4. Open `/dashboard/social`, click **Connect TikTok** / **Connect Instagram**, and approve.
5. Choose a video, write a caption, pick **Publish now** or **Schedule**, review the preview, then **Confirm**.

## TikTok

**Prerequisites**

- A TikTok developer app at [developers.tiktok.com](https://developers.tiktok.com/) with **Login Kit** and **Content Posting API** (Direct Post enabled).
- Scopes: `user.info.basic`, `video.publish`.

**Limits while the app is unaudited**

- Posts can only be private (`SELF_ONLY`, "Only me"); other privacy levels are rejected at publish time.
- The TikTok account must be private.
- At most 5 users can post through the app in 24 hours.
- Public posting needs TikTok's app audit.

Official docs: [Content sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines) · [Content Posting API — get started](https://developers.tiktok.com/doc/content-posting-api-get-started)

## Instagram

**Prerequisites**

- An Instagram **professional** account (Business or Creator) linked to a Facebook Page you manage.
- A Meta app of type **Business** with **Facebook Login for Business** and the **Instagram** product.
- Permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`.
- In development mode the app works for its own admins without App Review; publishing for other people needs App Review.

Videos are uploaded straight from your machine with resumable uploads; no public video URL is needed.

Official docs: [Resumable uploads](https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads)

## Redirect URIs

Register these exact URIs in each developer app:

| Platform | Redirect URI |
| --- | --- |
| TikTok | `<base>/api/social/tiktok/callback` |
| Instagram | `<base>/api/social/instagram/callback` |

`<base>` is `SOCIAL_OAUTH_BASE_URL` when set, otherwise `NEXTAUTH_URL` (for example `http://localhost:3102`).

## Environment variables

Add to `.env.local` (alongside the existing `NEXTAUTH_SECRET` and `NEXTAUTH_URL`):

| Variable | Required | Purpose |
| --- | --- | --- |
| `TIKTOK_CLIENT_KEY` | For TikTok | TikTok app client key |
| `TIKTOK_CLIENT_SECRET` | For TikTok | TikTok app client secret |
| `INSTAGRAM_APP_ID` | For Instagram | Meta app ID |
| `INSTAGRAM_APP_SECRET` | For Instagram | Meta app secret |
| `SOCIAL_OAUTH_BASE_URL` | No | Base URL for the redirect URIs, e.g. an HTTPS tunnel |
| `SOCIAL_WORKER_DISABLED` | No | Set to `1` to stop the in-app publishing worker |

Account tokens are encrypted at rest with a key derived from `NEXTAUTH_SECRET`. Changing that secret means reconnecting the accounts.

## HTTPS tunnel fallback

Some platforms reject `http://localhost` redirect URIs. Connecting an account is a one-time step, so a temporary HTTPS tunnel is enough:

1. Start a tunnel to port `3102` (any HTTPS tunnel tool) and note its URL.
2. Set `SOCIAL_OAUTH_BASE_URL=<tunnel URL>`, register the tunnel redirect URIs in the developer app, and restart the app.
3. Open the app **from the tunnel URL**, sign in there, and start the connection from `<tunnel URL>/dashboard/social`. The session and OAuth state cookies belong to the origin you start from, so starting from `localhost` makes the callback fail with an expired-connection error.
4. If signing in sends you back to `localhost`, temporarily set `NEXTAUTH_URL` to the tunnel URL too (and add its Google callback to your Google OAuth client).

After the account is connected you can remove the tunnel; publishing does not use redirect URIs.

## Scheduling behavior

- The app must be running: the publishing worker runs inside the Next.js server and checks for due posts periodically (every 30 seconds by default).
- A post found more than **5 minutes** after its scheduled time is marked **Missed** and is never published late. Reschedule it to publish.
- A post interrupted mid-upload (for example, the app stopped) is marked **Failed** with `INTERRUPTED`. Check the platform to see whether it was posted before rescheduling.
- Failed posts are never retried automatically.
- Rescheduling returns the post to draft; the new time needs a new preview and confirmation.

## First real run checklist

The platform endpoints, API versions and scopes were written from the public docs and have not been exercised against the live APIs yet.

- [ ] Compare `src/lib/social/platforms/tiktok/endpoints.ts` with the TikTok Content Posting API docs.
- [ ] Compare `src/lib/social/platforms/instagram/endpoints.ts` (Graph version, URLs, permissions) with the Meta docs.
- [ ] Connect each account and confirm the dashboard shows it.
- [ ] Publish one private TikTok (`SELF_ONLY`) and one Instagram Reel with **Publish now**.
- [ ] Schedule one post a few minutes ahead and confirm it publishes while the app runs.
