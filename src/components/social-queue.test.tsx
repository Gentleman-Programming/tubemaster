import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SocialPost } from "@/lib/social/contracts";
import { cancelSocialPost, requestSocialPosts, rescheduleSocialPost, SocialQueueContent } from "./social-queue";

const base: SocialPost = {
  id: "post-1",
  userId: "user-1",
  accountId: "acc-1",
  platform: "instagram",
  stagingFile: "abc123.mp4",
  caption: "Reel caption",
  platformOptions: { shareToFeed: true },
  scheduledAtUtc: "2026-10-22T21:30:00.000Z",
  timezone: "America/Argentina/Buenos_Aires",
  status: "scheduled",
  createdAt: "2026-10-21T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
};

test("loads the queue", async () => {
  let requested = "";
  const view = await requestSocialPosts(async (url) => {
    requested = url;
    return Response.json([base]);
  });
  assert.equal(requested, "/api/social/posts");
  assert.deepEqual(view, { kind: "result", posts: [base] });
});

test("maps queue loading failures", async () => {
  const view = await requestSocialPosts(async () => Response.json({ error: "INTERNAL_ERROR" }, { status: 500 }));
  assert.equal(view.kind, "error");
});

test("cancels and reschedules through the post routes", async () => {
  const calls: { url: string; method?: string; body?: unknown }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return url.endsWith("/cancel") ? Response.json({ ...base, status: "cancelled" }) : Response.json({ post: base, confirmationToken: "t" });
  };
  assert.equal((await cancelSocialPost("post-1", fetcher)).ok, true);
  assert.equal((await rescheduleSocialPost("post-1", { mode: "at", localDateTime: "2026-10-23T10:00:00", timezone: "UTC" }, fetcher)).ok, true);
  assert.deepEqual(calls, [
    { url: "/api/social/posts/post-1/cancel", method: "POST", body: undefined },
    {
      url: "/api/social/posts/post-1/reschedule",
      method: "POST",
      body: { schedule: { mode: "at", localDateTime: "2026-10-23T10:00:00", timezone: "UTC" } },
    },
  ]);
});

test("renders posts with status, time, errors and allowed actions", () => {
  const posts: SocialPost[] = [
    base,
    { ...base, id: "post-2", platform: "tiktok", status: "missed", error: { code: "MISSED", message: "Not published in time." } },
    { ...base, id: "post-3", status: "failed", error: { code: "INTERRUPTED", message: "Publishing was interrupted." } },
    { ...base, id: "post-4", status: "published" },
  ];
  const html = renderToStaticMarkup(<SocialQueueContent view={{ kind: "result", posts }} loading={false} />);
  assert.match(html, /Scheduled/);
  assert.match(html, /Missed/);
  assert.match(html, /app was not running at the scheduled time/);
  assert.match(html, /Not published in time\./);
  assert.match(html, /Publishing was interrupted\./);
  assert.match(html, /Oct 22, 2026, 18:30 \(America\/Argentina\/Buenos_Aires\)/);
  assert.match(html, /Reel caption/);
  // scheduled, missed and failed can be cancelled and rescheduled; published cannot.
  assert.equal(html.match(/>Cancel</g)?.length, 3);
  assert.equal(html.match(/>Reschedule</g)?.length, 3);
});

test("renders empty, loading and error states", () => {
  assert.match(renderToStaticMarkup(<SocialQueueContent view={{ kind: "result", posts: [] }} loading={false} />), /No posts yet/);
  assert.match(renderToStaticMarkup(<SocialQueueContent view={null} loading />), /Loading posts/);
  assert.match(renderToStaticMarkup(<SocialQueueContent view={{ kind: "error", message: "Boom." }} loading={false} />), /role="alert"/);
});
