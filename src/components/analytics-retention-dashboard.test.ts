import assert from "node:assert/strict";
import test from "node:test";
import { dateRangeForPreset, defaultRetentionFetcher, requestVideoRetention, retentionChartSeries, validateRetentionDateRange } from "./analytics-retention-dashboard";

test("provides one stable default video fetcher for the loading effect", () => {
  assert.equal(typeof defaultRetentionFetcher, "function");
  assert.strictEqual(defaultRetentionFetcher, defaultRetentionFetcher);
});

test("builds each preset and keeps recent videos within publication dates", () => {
  const now = new Date("2026-10-22T12:00:00.000Z");
  assert.deepEqual(dateRangeForPreset("7", now, "2025-04-30T00:00:00.000Z"), {
    startDate: "2026-10-16",
    endDate: "2026-10-22",
  });
  assert.deepEqual(dateRangeForPreset("30", now, "2025-04-30T00:00:00.000Z"), {
    startDate: "2026-09-23",
    endDate: "2026-10-22",
  });
  assert.deepEqual(dateRangeForPreset("90", now, "2025-04-30T00:00:00.000Z"), {
    startDate: "2026-07-25",
    endDate: "2026-10-22",
  });
  assert.deepEqual(dateRangeForPreset("30", now, "2026-10-01T00:00:00.000Z"), {
    startDate: "2026-10-01",
    endDate: "2026-10-22",
  });
});

test("validates custom ranges before requesting retention", () => {
  assert.equal(validateRetentionDateRange("2026-07-25", "2026-10-22", "2026-10-22"), null);
  assert.equal(validateRetentionDateRange("2026-07-24", "2026-10-22", "2026-10-22"), "Range exceeds 90 days");
  assert.equal(validateRetentionDateRange("2026-10-23", "2026-10-22", "2026-10-22"), "From date must be on or before To date");
  assert.equal(validateRetentionDateRange("2026-10-01", "2026-10-23", "2026-10-22"), "To date cannot be in the future");
});

test("sorts retention rows into chart series without changing their values", () => {
  assert.deepEqual(
    retentionChartSeries([
      { elapsedVideoTimeRatio: 1, audienceWatchRatio: 0.42, relativeRetentionPerformance: 0.8 },
      { elapsedVideoTimeRatio: 0, audienceWatchRatio: 1, relativeRetentionPerformance: 1.2 },
    ]),
    [
      { elapsedVideoTimeRatio: 0, audienceWatchRatio: 1, relativeRetentionPerformance: 1.2 },
      { elapsedVideoTimeRatio: 1, audienceWatchRatio: 0.42, relativeRetentionPerformance: 0.8 },
    ],
  );
});

test("requests retention for the selected video and date range", async () => {
  let requestUrl = "";
  await requestVideoRetention("video-1", "2025-04-30", "2025-06-15", async (url) => {
    requestUrl = url;
    return Response.json({ kind: "analytics-retention", videoId: "video-1", startDate: "2025-04-30", endDate: "2025-06-15", rows: [] });
  });
  assert.equal(requestUrl, "/api/youtube/analytics/retention?videoId=video-1&startDate=2025-04-30&endDate=2025-06-15");
});
