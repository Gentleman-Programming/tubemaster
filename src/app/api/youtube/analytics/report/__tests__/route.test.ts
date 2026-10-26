import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsReportGetHandler } from "../route";

const videos = [
  { videoId: "a", title: "Alpha", description: "", publishedAt: "2025-01-01T00:00:00Z" },
  { videoId: "b", title: "Beta", description: "", publishedAt: "2025-01-02T00:00:00Z" },
];

test("requires authentication before listing videos", async () => {
  let listed = false;
  const response = await createAnalyticsReportGetHandler({
    getSession: async () => null,
    listVideos: async () => { listed = true; return { videos }; },
    core: { fetchAnalyticsReport: async () => { throw new Error("must not call"); } },
  })(new URL("https://example.test/api/youtube/analytics/report?videoIds=a,b"));
  assert.equal(response.status, 401);
  assert.equal(listed, false);
});

test("lists visible videos and forwards only the selected bounded set", async () => {
  let captured: unknown;
  const response = await createAnalyticsReportGetHandler({
    getSession: async () => ({ user: { id: "user-1" } }),
    listVideos: async () => ({ videos }),
    core: { fetchAnalyticsReport: async (args) => { captured = args; return { kind: "analytics-multi-video-report", startDate: args.startDate, endDate: args.endDate, videos: [], totals: { views: 0, likes: 0, comments: 0, estimatedMinutesWatched: 0 } }; } },
  })(new URL("https://example.test/api/youtube/analytics/report?videoId=b&videoId=a&startDate=2025-06-09&endDate=2025-06-15"));
  assert.equal(response.status, 200);
  assert.deepEqual(captured, { credentialRef: { userId: "user-1" }, startDate: "2025-06-09", endDate: "2025-06-15", videos });
});

test("rejects stale or undersized selections before analytics calls", async () => {
  let called = false;
  const response = await createAnalyticsReportGetHandler({
    getSession: async () => ({ user: { id: "user-1" } }),
    listVideos: async () => ({ videos }),
    core: { fetchAnalyticsReport: async () => { called = true; throw new Error("must not call"); } },
  })(new URL("https://example.test/api/youtube/analytics/report?videoIds=a,stale"));
  assert.equal(response.status, 422);
  assert.equal(called, false);
});

test("does not expose provider errors", async () => {
  const response = await createAnalyticsReportGetHandler({
    getSession: async () => ({ user: { id: "user-1" } }),
    listVideos: async () => { throw new Error("provider secret"); },
    core: { fetchAnalyticsReport: async () => { throw new Error("provider secret"); } },
  })(new URL("https://example.test/api/youtube/analytics/report?videoIds=a,b"));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).message, "Unable to load analytics report");
});
