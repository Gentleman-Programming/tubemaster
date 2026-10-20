import assert from "node:assert/strict";
import test from "node:test";
import { SOCIAL_POST_STATUSES } from "../contracts";
import {
  callSocialApi,
  canCancelPost,
  canReschedulePost,
  connectBannerMessage,
  connectErrorMessage,
  describePlatformOptions,
  formatBytes,
  formatScheduledLocal,
  formatScheduledUtc,
  platformLabel,
  postStatusBadge,
  queueErrorMessage,
  readApiError,
  TIKTOK_PRIVACY_OPTIONS,
  TIKTOK_UNAUDITED_NOTICE,
  toLocalDateTime,
} from "../presentation";

test("labels both platforms", () => {
  assert.equal(platformLabel("tiktok"), "TikTok");
  assert.equal(platformLabel("instagram"), "Instagram");
});

test("every post status has a label, description and tone", () => {
  for (const status of SOCIAL_POST_STATUSES) {
    const badge = postStatusBadge(status);
    assert.ok(badge.label.length > 0, status);
    assert.ok(badge.description.length > 0, status);
    assert.ok(badge.className.length > 0, status);
  }
  assert.equal(postStatusBadge("published").label, "Published");
  assert.equal(postStatusBadge("missed").label, "Missed");
});

test("missed explains why and how to recover (S3)", () => {
  const { description } = postStatusBadge("missed");
  assert.match(description, /app was not running at the scheduled time/);
  assert.match(description, /[Rr]eschedule to publish/);
});

test("allowed actions follow the queue rules (S8)", () => {
  const cancellable = SOCIAL_POST_STATUSES.filter(canCancelPost);
  const reschedulable = SOCIAL_POST_STATUSES.filter(canReschedulePost);
  assert.deepEqual(cancellable, ["draft", "scheduled", "missed"]);
  assert.deepEqual(reschedulable, ["scheduled", "missed"]);
});

test("maps OAuth callback error codes to user messages", () => {
  assert.match(connectErrorMessage("access_denied"), /cancelled|denied/i);
  assert.match(connectErrorMessage("invalid_state"), /expired|start the connection again/i);
  assert.match(connectErrorMessage("not_configured"), /\.env\.local/);
  assert.match(connectErrorMessage("exchange_failed"), /could not finish/i);
  assert.match(connectErrorMessage("storage_failed"), /could not be saved/i);
  assert.match(connectErrorMessage("no_instagram_business_account"), /professional/i);
  assert.match(connectErrorMessage("something_else"), /could not be connected/i);
});

test("builds the connected banner only for known platforms", () => {
  assert.equal(connectBannerMessage("tiktok"), "TikTok account connected.");
  assert.equal(connectBannerMessage("x"), null);
  assert.equal(connectBannerMessage(null), null);
});

test("maps queue error codes to user messages", () => {
  assert.match(queueErrorMessage("CONFIRMATION_EXPIRED"), /[Pp]review the post again/);
  assert.match(queueErrorMessage("CONFIRMATION_INVALID"), /[Pp]review the post again/);
  assert.match(queueErrorMessage("ACCOUNT_NOT_CONNECTED"), /[Cc]onnect/);
  assert.match(queueErrorMessage("STAGED_VIDEO_INVALID"), /[Ss]tage the video again/);
  assert.match(queueErrorMessage("UNAUTHORIZED"), /[Ss]ign in/);
  assert.match(queueErrorMessage("INVALID_INPUT", "The scheduled time must be in the future"), /must be in the future/);
  assert.match(queueErrorMessage("INVALID_STATE", "A published post cannot be cancelled"), /cannot be cancelled/);
  assert.match(queueErrorMessage(undefined), /try again/i);
});

test("reads the error code from API bodies", () => {
  assert.deepEqual(readApiError({ error: "CONFIRMATION_EXPIRED", message: "expired" }), { code: "CONFIRMATION_EXPIRED", message: "expired" });
  assert.deepEqual(readApiError({ code: "NOT_FOUND" }), { code: "NOT_FOUND", message: undefined });
  assert.deepEqual(readApiError("oops"), { code: undefined, message: undefined });
});

test("formats the scheduled time in the given timezone and in UTC", () => {
  const utc = "2026-10-21T21:30:00.000Z";
  const local = formatScheduledLocal(utc, "America/Argentina/Buenos_Aires");
  assert.match(local, /Oct 21, 2026/);
  assert.match(local, /18:30/);
  assert.match(local, /America\/Argentina\/Buenos_Aires/);
  assert.match(formatScheduledUtc(utc), /21:30 UTC/);
  assert.equal(formatScheduledLocal("not a date", "UTC"), "not a date");
});

test("falls back to UTC for an invalid timezone", () => {
  assert.match(formatScheduledLocal("2026-10-21T21:30:00.000Z", "Not/AZone"), /21:30 \(UTC\)/);
});

test("joins date and time into the queue localDateTime shape", () => {
  assert.equal(toLocalDateTime("2026-10-21", "18:30"), "2026-10-21T18:30:00");
  assert.equal(toLocalDateTime("2026-10-21", ""), null);
  assert.equal(toLocalDateTime("21/10/2026", "18:30"), null);
});

test("TikTok privacy options and the unaudited notice (S7)", () => {
  assert.deepEqual(
    TIKTOK_PRIVACY_OPTIONS.map((option) => option.value),
    ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"],
  );
  assert.match(TIKTOK_UNAUDITED_NOTICE, /SELF_ONLY/);
  assert.match(TIKTOK_UNAUDITED_NOTICE, /private/i);
  assert.match(TIKTOK_UNAUDITED_NOTICE, /audit/i);
});

test("describes platform options for the preview", () => {
  assert.deepEqual(
    describePlatformOptions("tiktok", { privacyLevel: "SELF_ONLY", disableComment: true, disableDuet: false, disableStitch: true }),
    ["Privacy: Only me (SELF_ONLY)", "Comments: off", "Duet: on", "Stitch: off"],
  );
  assert.deepEqual(describePlatformOptions("instagram", { shareToFeed: false }), ["Share to feed: no"]);
  assert.deepEqual(describePlatformOptions("instagram", {}), ["Share to feed: yes"]);
});

test("formats file sizes", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(15 * 1024 * 1024), "15.0 MB");
});

test("callSocialApi returns the body or a mapped error", async () => {
  const success = await callSocialApi<{ accounts: [] }>(async () => Response.json({ accounts: [] }), "/api/social/accounts");
  assert.deepEqual(success, { ok: true, body: { accounts: [] } });

  const expired = await callSocialApi(async () => Response.json({ error: "CONFIRMATION_EXPIRED", message: "x" }, { status: 403 }), "/x");
  assert.equal(expired.ok, false);
  if (!expired.ok) {
    assert.equal(expired.code, "CONFIRMATION_EXPIRED");
    assert.match(expired.message, /Preview the post again/);
  }

  const unauthorized = await callSocialApi(async () => new Response("nope", { status: 401 }), "/x");
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.equal(unauthorized.code, "UNAUTHORIZED");

  const offline = await callSocialApi(async () => { throw new Error("offline"); }, "/x");
  assert.equal(offline.ok, false);
  if (!offline.ok) assert.match(offline.message, /try again/i);
});
