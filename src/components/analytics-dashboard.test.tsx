import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsDateRangeForPreset,
  formatAnalyticsDelta,
  requestAnalyticsComparison,
  requestAnalyticsSummary,
  serializeAnalyticsCsv,
} from "./analytics-dashboard";

const now = new Date("2025-06-15T12:00:00Z");

test("builds rolling seven, thirty, and ninety day ranges", () => {
  assert.deepEqual(analyticsDateRangeForPreset("7", now), {
    startDate: "2025-06-09",
    endDate: "2025-06-15",
  });
  assert.deepEqual(analyticsDateRangeForPreset("30", now), {
    startDate: "2025-05-17",
    endDate: "2025-06-15",
  });
  assert.deepEqual(analyticsDateRangeForPreset("90", now), {
    startDate: "2025-03-18",
    endDate: "2025-06-15",
  });
});

test("requests the selected date range and returns the summary", async () => {
  let requestUrl = "";
  const result = await requestAnalyticsSummary("2025-05-17", "2025-06-15", async (url) => {
    requestUrl = url;
    return Response.json({
      kind: "analytics-summary",
      startDate: "2025-05-17",
      endDate: "2025-06-15",
      days: [],
    });
  });
  assert.equal(requestUrl, "/api/youtube/analytics?startDate=2025-05-17&endDate=2025-06-15");
  assert.deepEqual(result.days, []);
});

test("requests both current and immediately preceding periods", async () => {
  const requestUrls: string[] = [];
  const result = await requestAnalyticsComparison(
    { startDate: "2025-06-09", endDate: "2025-06-15" },
    { startDate: "2025-06-02", endDate: "2025-06-08" },
    async (url) => {
      requestUrls.push(url);
      return Response.json({
        kind: "analytics-summary",
        startDate: url.includes("06-09") ? "2025-06-09" : "2025-06-02",
        endDate: url.includes("06-15") ? "2025-06-15" : "2025-06-08",
        days: [],
      });
    },
  );
  assert.deepEqual(requestUrls.sort(), [
    "/api/youtube/analytics?startDate=2025-06-02&endDate=2025-06-08",
    "/api/youtube/analytics?startDate=2025-06-09&endDate=2025-06-15",
  ]);
  assert.equal(result.current.startDate, "2025-06-09");
  assert.equal(result.previous.endDate, "2025-06-08");
});

test("formats deltas without implying growth from a zero baseline", () => {
  assert.equal(formatAnalyticsDelta({ absolute: 10, percentage: 25 }), "+25.0% (+10)");
  assert.equal(formatAnalyticsDelta({ absolute: -10, percentage: -25 }), "-25.0% (-10)");
  assert.equal(formatAnalyticsDelta({ absolute: 10, percentage: null }), "New (+10)");
  assert.equal(formatAnalyticsDelta({ absolute: 0, percentage: 0 }), "0.0% (0)");
});

test("surfaces API error messages for failed summaries", async () => {
  await assert.rejects(
    requestAnalyticsSummary("2025-05-17", "2025-06-15", async () =>
      Response.json({ message: "Reauthorization required" }, { status: 403 }),
    ),
    /Reauthorization required/,
  );
});

test("serializes daily metrics as a spreadsheet-safe CSV", () => {
  assert.equal(
    serializeAnalyticsCsv([
      {
        date: "2025-06-15",
        views: 1000,
        likes: 25,
        comments: 4,
        estimatedMinutesWatched: 123.5,
      },
    ]),
    "date,views,likes,comments,estimatedMinutesWatched\r\n2025-06-15,1000,25,4,123.5",
  );
});
