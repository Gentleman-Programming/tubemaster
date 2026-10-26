import type { AnalyticsMetricRow } from "@/lib/youtube-analytics-summary/contracts";
import { calculateMetricDelta, type AnalyticsMetricDelta } from "@/lib/youtube-analytics-summary/comparison";
import type { VideoMetadataItem } from "@/lib/video-metadata/contracts";

export type MultiVideoReportVideo = {
  videoId: string;
  title: string;
  current: AnalyticsMetricRow;
  previous: AnalyticsMetricRow;
  deltas: {
    views: AnalyticsMetricDelta;
    likes: AnalyticsMetricDelta;
    comments: AnalyticsMetricDelta;
    estimatedMinutesWatched: AnalyticsMetricDelta;
  };
};

export type MultiVideoReport = {
  kind: "analytics-multi-video-report";
  startDate: string;
  endDate: string;
  videos: MultiVideoReportVideo[];
  totals: AnalyticsMetricRow;
};

export function validateReportVideoSelection(
  videoIds: readonly string[],
  loadedVideos: readonly VideoMetadataItem[],
): { ok: true; videos: VideoMetadataItem[] } | { ok: false; message: string } {
  if (videoIds.length < 2 || videoIds.length > 10) return { ok: false, message: "Select between 2 and 10 videos" };
  if (new Set(videoIds).size !== videoIds.length) return { ok: false, message: "Select between 2 and 10 videos" };
  const loadedIds = new Set(loadedVideos.map((video) => video.videoId));
  if (videoIds.some((videoId) => !loadedIds.has(videoId))) return { ok: false, message: "Select only videos from the loaded channel list" };
  const selectedIds = new Set(videoIds);
  return { ok: true, videos: loadedVideos.filter((video) => selectedIds.has(video.videoId)) };
}

export function aggregateAnalyticsMetrics(rows: readonly AnalyticsMetricRow[]): AnalyticsMetricRow {
  return rows.reduce((totals, row) => ({
    views: totals.views + row.views,
    likes: totals.likes + row.likes,
    comments: totals.comments + row.comments,
    estimatedMinutesWatched: totals.estimatedMinutesWatched + row.estimatedMinutesWatched,
  }), { views: 0, likes: 0, comments: 0, estimatedMinutesWatched: 0 });
}

export function calculateReportMetricDeltas(current: AnalyticsMetricRow, previous: AnalyticsMetricRow) {
  return {
    views: calculateMetricDelta(current.views, previous.views),
    likes: calculateMetricDelta(current.likes, previous.likes),
    comments: calculateMetricDelta(current.comments, previous.comments),
    estimatedMinutesWatched: calculateMetricDelta(current.estimatedMinutesWatched, previous.estimatedMinutesWatched),
  };
}

export function serializeMultiVideoReportJson(report: MultiVideoReport): string {
  return JSON.stringify(report, null, 2);
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) || safe !== text ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function serializeMultiVideoReportCsv(report: MultiVideoReport): string {
  const header = "videoId,title,views,likes,comments,estimatedMinutesWatched,viewsDelta,likesDelta,commentsDelta,estimatedMinutesWatchedDelta";
  const rows = report.videos.map((video) => [
    video.videoId,
    video.title,
    video.current.views,
    video.current.likes,
    video.current.comments,
    video.current.estimatedMinutesWatched,
    video.deltas.views.absolute,
    video.deltas.likes.absolute,
    video.deltas.comments.absolute,
    video.deltas.estimatedMinutesWatched.absolute,
  ].map(csvCell).join(","));
  return [header, ...rows].join("\r\n");
}
