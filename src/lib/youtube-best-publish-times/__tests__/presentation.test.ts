import assert from "node:assert/strict";
import test from "node:test";
import type { BestPublishTimesResult, PublishSlot } from "../contracts";
import {
  bestPublishTimesErrorMessage,
  formatScore,
  formatSlot,
  toBestPublishTimesView,
} from "../presentation";

const slot = (overrides: Partial<PublishSlot> = {}): PublishSlot => ({
  weekday: "thursday",
  startHour: 18,
  endHour: 21,
  score: 3.2,
  sampleSize: 4,
  medianEarlyViews: 3200,
  ...overrides,
});

const result = (overrides: Partial<BestPublishTimesResult> = {}): BestPublishTimesResult => ({
  kind: "best-publish-times",
  timezone: "America/Argentina/Buenos_Aires",
  analyzedVideos: 42,
  excludedVideos: 3,
  channelMedianEarlyViews: 1000,
  confidence: "normal",
  slots: [slot(), slot({ weekday: "monday", startHour: 0, endHour: 3, score: 1.25, sampleSize: 2 })],
  method: { maxVideos: 50, minVideoAgeDays: 4, earlyWindowDays: 3, slotHours: 3, minSlotSamples: 2 },
  ...overrides,
});

test("formats a slot as a readable weekday and hour range", () => {
  assert.equal(formatSlot(slot()), "Thursday 18:00–21:00");
  assert.equal(formatSlot(slot({ weekday: "monday", startHour: 0, endHour: 3 })), "Monday 00:00–03:00");
  assert.equal(formatSlot(slot({ weekday: "sunday", startHour: 21, endHour: 24 })), "Sunday 21:00–24:00");
});

test("formats a score relative to the channel median", () => {
  assert.equal(formatScore(3.2), "3.2× your channel median");
  assert.equal(formatScore(1), "1.0× your channel median");
  assert.equal(formatScore(0.456), "0.5× your channel median");
});

test("maps a normal result to ranked slots without a low-confidence notice", () => {
  const view = toBestPublishTimesView(result());
  assert.equal(view.kind, "result");
  if (view.kind !== "result") return;
  assert.equal(view.timezone, "America/Argentina/Buenos_Aires");
  assert.deepEqual(view.slots, [
    { rank: 1, label: "Thursday 18:00–21:00", scoreLabel: "3.2× your channel median", sampleLabel: "4 videos" },
    { rank: 2, label: "Monday 00:00–03:00", scoreLabel: "1.3× your channel median", sampleLabel: "2 videos" },
  ]);
  assert.equal(view.lowConfidence, false);
  assert.equal(view.confidenceNotice, null);
  assert.equal(view.emptyMessage, null);
  assert.equal(view.countsLabel, "42 videos analyzed, 3 excluded (published less than 4 days ago).");
});

test("flags low confidence with a visible notice", () => {
  const view = toBestPublishTimesView(result({ confidence: "low", analyzedVideos: 6 }));
  assert.equal(view.kind, "result");
  if (view.kind !== "result") return;
  assert.equal(view.lowConfidence, true);
  assert.match(view.confidenceNotice ?? "", /Low confidence/);
  assert.match(view.confidenceNotice ?? "", /6 videos/);
});

test("returns an empty-state message when no slot has enough videos", () => {
  const view = toBestPublishTimesView(result({ confidence: "low", analyzedVideos: 1, excludedVideos: 0, slots: [] }));
  assert.equal(view.kind, "result");
  if (view.kind !== "result") return;
  assert.deepEqual(view.slots, []);
  assert.match(view.emptyMessage ?? "", /at least 2 videos/);
  assert.equal(view.countsLabel, "1 video analyzed, 0 excluded (published less than 4 days ago).");
});

test("maps each error code to a user-facing message", () => {
  assert.match(bestPublishTimesErrorMessage("AUTH_REQUIRED"), /Sign in/);
  assert.match(
    bestPublishTimesErrorMessage("AUTH_SCOPE_INSUFFICIENT"),
    /Sign in again to grant YouTube Analytics access/,
  );
  assert.match(bestPublishTimesErrorMessage("INVALID_INPUT", "timezone must be a valid IANA timezone"), /timezone must be a valid IANA timezone/);
  assert.match(bestPublishTimesErrorMessage("ANALYTICS_API_ERROR"), /YouTube Analytics/);
  assert.match(bestPublishTimesErrorMessage(undefined), /Unable to load best publish times/);

  const view = toBestPublishTimesView({
    kind: "best-publish-times-error",
    code: "AUTH_SCOPE_INSUFFICIENT",
    message: "Reauthorization with the yt-analytics.readonly scope is required.",
    requiredScopes: ["yt-analytics.readonly"],
  });
  assert.equal(view.kind, "error");
  if (view.kind !== "error") return;
  assert.match(view.message, /Sign in again to grant YouTube Analytics access/);
});
