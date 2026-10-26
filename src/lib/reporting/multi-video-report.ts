import type { AnalyticsMetricRow } from "@/lib/youtube-analytics-summary/contracts";
import {
  calculateMetricDelta,
  calculatePeriodComparison,
  type AnalyticsDateRange,
  type AnalyticsMetricDelta,
} from "@/lib/youtube-analytics-summary/comparison";
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

type ReportPeriodDirection = "previous" | "next";
const DAY_MS = 86_400_000;

function parseReportDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid date");
  }
  return date;
}

function formatReportDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftReportPeriod(
  startDate: string,
  endDate: string,
  direction: ReportPeriodDirection,
  today: string | Date = new Date(),
): AnalyticsDateRange {
  calculatePeriodComparison(startDate, endDate);
  const start = parseReportDate(startDate);
  const end = parseReportDate(endDate);
  const todayDate = typeof today === "string" ? parseReportDate(today) : today;
  if (end > todayDate) throw new Error("Future date");

  const length = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const offset = (direction === "next" ? 1 : -1) * length * DAY_MS;
  const shiftedStart = new Date(start.getTime() + offset);
  const shiftedEnd = new Date(end.getTime() + offset);
  if (shiftedEnd > todayDate) throw new Error("Future date");

  return { startDate: formatReportDate(shiftedStart), endDate: formatReportDate(shiftedEnd) };
}

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
