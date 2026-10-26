import assert from "node:assert/strict";
import test from "node:test";
import { createYoutubeAnalyticsReportService } from "../services";
import {
  aggregateAnalyticsMetrics,
  calculateReportMetricDeltas,
  serializeMultiVideoReportCsv,
  serializeMultiVideoReportJson,
  validateReportVideoSelection,
} from "../../reporting/multi-video-report";

const metric = (views: number, likes = 2, comments = 1, estimatedMinutesWatched = 3) => ({
  views, likes, comments, estimatedMinutesWatched,
});

const videos = [
  { videoId: "a", title: "Alpha", description: "", publishedAt: "2025-01-01T00:00:00Z" },
  { videoId: "b", title: "Beta", description: "", publishedAt: "2025-01-02T00:00:00Z" },
];

test("validates bounded visible multi-video selections", () => {
  assert.deepEqual(validateReportVideoSelection(["b", "a"], videos), { ok: true, videos: [videos[0], videos[1]] });
  assert.deepEqual(validateReportVideoSelection(["a", "stale"], videos), { ok: false, message: "Select only videos from the loaded channel list" });
  assert.deepEqual(validateReportVideoSelection(["a"], videos), { ok: false, message: "Select between 2 and 10 videos" });
  assert.deepEqual(validateReportVideoSelection(Array.from({ length: 11 }, (_, index) => `v-${index}`), videos), { ok: false, message: "Select between 2 and 10 videos" });
});

test("aggregates metrics and calculates deterministic previous-period deltas", () => {
  const current = aggregateAnalyticsMetrics([metric(10, 3, 2, 4), metric(5, 1, 0, 2)]);
  assert.deepEqual(current, { views: 15, likes: 4, comments: 2, estimatedMinutesWatched: 6 });
  assert.deepEqual(calculateReportMetricDeltas(current, metric(10, 2, 1, 3)), {
    views: { absolute: 5, percentage: 50 },
    likes: { absolute: 2, percentage: 100 },
    comments: { absolute: 1, percentage: 100 },
    estimatedMinutesWatched: { absolute: 3, percentage: 100 },
  });
});

test("serializes the displayed report locally", () => {
  const report = {
    kind: "analytics-multi-video-report" as const,
    startDate: "2025-06-09",
    endDate: "2025-06-15",
    videos: [{ videoId: "a", title: "Alpha", current: metric(10), previous: metric(5), deltas: calculateReportMetricDeltas(metric(10), metric(5)) }],
    totals: metric(10),
  };
  assert.match(serializeMultiVideoReportJson(report), /"videoId": "a"/);
  assert.match(serializeMultiVideoReportCsv(report), /videoId,title,views,likes,comments,estimatedMinutesWatched/);
  assert.match(serializeMultiVideoReportCsv(report), /a,Alpha,10,2,1,3/);
});

test("rejects invalid report input without resolving credentials or querying analytics", async () => {
  let authCalls = 0;
  let queryCalls = 0;
  const service = createYoutubeAnalyticsReportService({
    authResolver: { resolve: async () => { authCalls += 1; throw new Error("must not resolve"); } },
    youtubeAnalyticsApi: {
      queryVideoSummary: async () => { queryCalls += 1; return metric(1); },
    },
    now: () => new Date("2025-06-15T12:00:00Z"),
  });
  const result = await service({
    credentialRef: { userId: "user-1" },
    startDate: "2025-06-09",
    endDate: "2025-06-15",
    videos: [videos[0]],
  });
  assert.deepEqual(result, { kind: "analytics-multi-video-report-error", code: "INVALID_INPUT", message: "Select between 2 and 10 videos" });
  assert.equal(authCalls, 0);
  assert.equal(queryCalls, 0);
});

test("queries current and previous metrics for each selected video", async () => {
  const calls: { videoId: string; startDate: string; endDate: string }[] = [];
  const service = createYoutubeAnalyticsReportService({
    authResolver: { resolve: async () => ({ credentialRef: { userId: "user-1" }, accessToken: "token", scopeSet: new Set() }) },
    youtubeAnalyticsApi: {
      queryVideoSummary: async (args) => { calls.push({ videoId: args.videoId, startDate: args.startDate, endDate: args.endDate }); return metric(args.videoId === "a" ? 10 : 5); },
    },
    now: () => new Date("2025-06-15T12:00:00Z"),
  });
  const result = await service({ credentialRef: { userId: "user-1" }, startDate: "2025-06-09", endDate: "2025-06-15", videos });
  assert.equal(result.kind, "analytics-multi-video-report");
  if (result.kind !== "analytics-multi-video-report") return;
  assert.deepEqual(result.totals, metric(15, 4, 2, 6));
  assert.equal(result.videos[0].deltas.views.absolute, 0);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(({ videoId, startDate, endDate }) => `${videoId}:${startDate}:${endDate}`).sort(), [
    "a:2025-06-02:2025-06-08", "a:2025-06-09:2025-06-15", "b:2025-06-02:2025-06-08", "b:2025-06-09:2025-06-15",
  ]);
});
