import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsDateRangeForPreset,
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
