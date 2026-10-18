import type { AnalyticsDayRow } from "./contracts";

export type AnalyticsDateRange = { startDate: string; endDate: string };
export type AnalyticsMetricTotals = Pick<
  AnalyticsDayRow,
  "views" | "likes" | "comments" | "estimatedMinutesWatched"
>;
export type AnalyticsMetricDelta = {
  absolute: number;
  percentage: number | null;
};

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string): Date {
  if (!DATE_PATTERN.test(value)) throw new Error("Invalid date");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Invalid date");
  }
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calculatePeriodComparison(
  startDate: string,
  endDate: string,
): { current: AnalyticsDateRange; previous: AnalyticsDateRange } {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start > end) throw new Error("startDate must be <= endDate");

  const length = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (length > 90) throw new Error("Range exceeds 90 days");

  const previousEnd = new Date(start.getTime() - DAY_MS);
  const previousStart = new Date(previousEnd.getTime() - (length - 1) * DAY_MS);
  return {
    current: { startDate, endDate },
    previous: {
      startDate: formatDate(previousStart),
      endDate: formatDate(previousEnd),
    },
  };
}

export function sumAnalyticsDays(
  days: readonly AnalyticsDayRow[],
): AnalyticsMetricTotals {
  return days.reduce(
    (totals, day) => ({
      views: totals.views + day.views,
      likes: totals.likes + day.likes,
      comments: totals.comments + day.comments,
      estimatedMinutesWatched:
        totals.estimatedMinutesWatched + day.estimatedMinutesWatched,
    }),
    { views: 0, likes: 0, comments: 0, estimatedMinutesWatched: 0 },
  );
}

export function calculateMetricDelta(
  current: number,
  previous: number,
): AnalyticsMetricDelta {
  const absolute = current - previous;
  return {
    absolute,
    percentage:
      previous === 0 ? (current === 0 ? 0 : null) : (absolute / previous) * 100,
  };
}
