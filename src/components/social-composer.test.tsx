import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SocialAccount, SocialPost } from "@/lib/social/contracts";
import {
  buildPreviewBody,
  confirmSocialPost,
  emptyComposerForm,
  requestPostPreview,
  SocialComposer,
  SocialPostPreviewCard,
  stageSocialVideo,
  validateComposer,
  type SocialPostPreview,
} from "./social-composer";

const account = (platform: SocialAccount["platform"]): SocialAccount => ({
  id: `acc-${platform}`,
  userId: "user-1",
  platform,
  externalAccountId: `ext-${platform}`,
  displayName: `My ${platform}`,
  scopes: [],
  tokenExpiresAt: null,
  connectedAt: "2026-10-21T12:00:00.000Z",
});

const post: SocialPost = {
  id: "post-1",
  userId: "user-1",
  accountId: "acc-tiktok",
  platform: "tiktok",
  stagingFile: "abc123.mp4",
  caption: "Hello TikTok",
  platformOptions: { privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: true, disableStitch: false },
  scheduledAtUtc: "2026-10-22T21:30:00.000Z",
  timezone: "America/Argentina/Buenos_Aires",
  status: "draft",
  createdAt: "2026-10-21T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
};

const preview: SocialPostPreview = {
  post,
  scheduledAtUtc: post.scheduledAtUtc,
  account: { id: "acc-tiktok", platform: "tiktok", displayName: "My TikTok" },
  video: { stagingFile: "abc123.mp4", size: 15 * 1024 * 1024 },
  confirmationToken: "1700000000.token",
  confirmationExpiresAt: "2026-10-21T12:10:00.000Z",
};

const form = {
  ...emptyComposerForm,
  platform: "tiktok" as const,
  caption: "Hello TikTok",
  privacyLevel: "SELF_ONLY",
  disableDuet: true,
  mode: "at" as const,
  date: "2026-10-22",
  time: "18:30",
  timezone: "America/Argentina/Buenos_Aires",
};

test("validates required fields, caption length and schedule", () => {
  assert.deepEqual(validateComposer(form, "abc123.mp4", ["tiktok"]), {});
  const errors = validateComposer({ ...emptyComposerForm, caption: "x".repeat(2201), mode: "at" }, "", ["tiktok"]);
  assert.ok(errors.video);
  assert.ok(errors.platform);
  assert.match(errors.caption ?? "", /2200/);
  assert.ok(errors.schedule);
  assert.ok(validateComposer({ ...form, platform: "instagram" }, "abc123.mp4", ["tiktok"]).platform);
  assert.ok(validateComposer({ ...form, caption: "   " }, "abc123.mp4", ["tiktok"]).caption);
  assert.ok(validateComposer({ ...form, timezone: "Not/AZone" }, "abc123.mp4", ["tiktok"]).schedule);
});

test("builds the preview body per platform", () => {
  assert.deepEqual(buildPreviewBody(form, "abc123.mp4"), {
    platform: "tiktok",
    stagingFile: "abc123.mp4",
    caption: "Hello TikTok",
    platformOptions: { privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: true, disableStitch: false },
    schedule: { mode: "at", localDateTime: "2026-10-22T18:30:00", timezone: "America/Argentina/Buenos_Aires" },
  });
  assert.deepEqual(buildPreviewBody({ ...form, platform: "instagram", shareToFeed: false, mode: "now" }, "abc123.mp4"), {
    platform: "instagram",
    stagingFile: "abc123.mp4",
    caption: "Hello TikTok",
    platformOptions: { shareToFeed: false },
    schedule: { mode: "now" },
  });
});

test("stages the file as multipart and validates the reply", async () => {
  let sent: FormData | null = null;
  const staged = await stageSocialVideo(new File(["data"], "clip.mp4"), async (url, init) => {
    assert.equal(url, "/api/youtube/upload/stage");
    assert.equal(init?.method, "POST");
    sent = init?.body as FormData;
    return Response.json({ stagingFile: "abc123.mp4", filename: "clip.mp4", size: 4 });
  });
  assert.ok((sent as FormData | null)?.get("file"));
  assert.deepEqual(staged, { ok: true, staged: { stagingFile: "abc123.mp4", filename: "clip.mp4", size: 4 } });

  const rejected = await stageSocialVideo(new File(["data"], "clip.mp4"), async () => Response.json({ error: "validation_failed" }, { status: 400 }));
  assert.equal(rejected.ok, false);
});

test("posts the preview body and confirms with the token", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return url.endsWith("/confirm") ? Response.json({ ...post, status: "scheduled" }) : Response.json(preview, { status: 201 });
  };
  const previewed = await requestPostPreview(buildPreviewBody(form, "abc123.mp4"), fetcher);
  assert.equal(previewed.ok, true);
  const confirmed = await confirmSocialPost("post-1", "1700000000.token", fetcher);
  assert.equal(confirmed.ok, true);
  assert.equal(calls[0].url, "/api/social/posts");
  assert.deepEqual(calls[1], { url: "/api/social/posts/post-1/confirm", body: { confirmationToken: "1700000000.token" } });
});

test("reports an expired confirmation with its code", async () => {
  const result = await confirmSocialPost("post-1", "t", async () =>
    Response.json({ error: "CONFIRMATION_EXPIRED", message: "expired" }, { status: 403 }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "CONFIRMATION_EXPIRED");
    assert.match(result.message, /Preview the post again/);
  }
});

test("the preview shows exactly what will be posted and requires confirmation", () => {
  const html = renderToStaticMarkup(
    <SocialPostPreviewCard preview={preview} videoName="clip.mp4" displayTimezone="America/Argentina/Buenos_Aires" busy={false} onConfirm={() => {}} onBack={() => {}} />,
  );
  assert.match(html, /My TikTok/);
  assert.match(html, /Hello TikTok/);
  assert.match(html, /Privacy: Only me \(SELF_ONLY\)/);
  assert.match(html, /Duet: off/);
  assert.match(html, /Oct 22, 2026, 18:30 \(America\/Argentina\/Buenos_Aires\)/);
  assert.match(html, /21:30 UTC/);
  assert.match(html, /clip\.mp4/);
  assert.match(html, /15\.0 MB/);
  assert.match(html, /Confirm and schedule/);
  assert.match(html, /Nothing is posted until you confirm/);
});

test("the composer offers only connected platforms and the TikTok options", () => {
  const html = renderToStaticMarkup(<SocialComposer accounts={[account("tiktok")]} stagingFile="abc123.mp4" />);
  assert.match(html, /Using staged file/);
  assert.match(html, /abc123\.mp4/);
  assert.match(html, /value="tiktok"/);
  assert.doesNotMatch(html, /value="instagram"/);
  for (const level of ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"]) {
    assert.match(html, new RegExp(`value="${level}"`));
  }
  assert.match(html, /Disable comments/);
  assert.match(html, /Disable duet/);
  assert.match(html, /Disable stitch/);
  assert.match(html, /SELF_ONLY\) and the TikTok account must be private/);
  assert.match(html, /Publish now/);
  assert.match(html, /Schedule/);
  assert.match(html, /maxLength="2200"/);
});

test("the composer shows Instagram options when only Instagram is connected", () => {
  const html = renderToStaticMarkup(<SocialComposer accounts={[account("instagram")]} />);
  assert.match(html, /Share to feed/);
  assert.doesNotMatch(html, /Disable duet/);
});

test("the composer asks to connect an account first", () => {
  const html = renderToStaticMarkup(<SocialComposer accounts={[]} />);
  assert.match(html, /Connect a TikTok or Instagram account/);
});

test("rejects a schedule that falls in a DST gap", () => {
  const errors = validateComposer({ ...form, date: "2026-03-08", time: "02:30", timezone: "America/New_York" }, "abc123.mp4", ["tiktok"]);
  assert.match(errors.schedule ?? "", /does not exist or is ambiguous/);
});

test("the composer opens the date picker prefilled from a calendar link", () => {
  const html = renderToStaticMarkup(
    <SocialComposer
      accounts={[account("tiktok")]}
      stagingFile="abc123.mp4"
      initialSchedule={{ localDateTime: "2026-10-22T09:00:00", timezone: "America/Argentina/Buenos_Aires" }}
    />,
  );
  assert.match(html, /checked="" value="at"/);
  assert.match(html, /role="grid"/);
  assert.match(html, /aria-label="Publish date, October 2026"/);
  assert.match(html, /aria-label="Publish time"/);
  assert.match(html, /aria-label="IANA timezone"/);
  assert.match(html, /Thursday, October 22, 2026 · 09:00 \(America\/Argentina\/Buenos_Aires\)/);
  assert.doesNotMatch(html, /type="date"/);
});
