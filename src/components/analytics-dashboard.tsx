"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalyticsDayRow, AnalyticsSummaryError, AnalyticsSummaryResult } from "@/lib/youtube-analytics-summary";
import {
  calculateMetricDelta,
  calculatePeriodComparison,
  sumAnalyticsDays,
  type AnalyticsDateRange,
  type AnalyticsMetricDelta,
} from "@/lib/youtube-analytics-summary/comparison";

type Preset = "7" | "30" | "90" | "custom";
type DateRange = AnalyticsDateRange;
type AnalyticsFetcher = (url: string) => Promise<Response>;
type AnalyticsComparisonResult = {
  current: AnalyticsSummaryResult;
  previous: AnalyticsSummaryResult;
};

const csvHeader = "date,views,likes,comments,estimatedMinutesWatched";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

export function analyticsDateRangeForPreset(preset: Exclude<Preset, "custom">, now = new Date()): DateRange {
  const end = startOfDay(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Number(preset) + 1);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

export async function requestAnalyticsSummary(
  startDate: string,
  endDate: string,
  fetcher: AnalyticsFetcher = (url) => fetch(url),
): Promise<AnalyticsSummaryResult> {
  const query = new URLSearchParams({ startDate, endDate });
  const response = await fetcher(`/api/youtube/analytics?${query}`);
  const body = (await response.json()) as AnalyticsSummaryResult | AnalyticsSummaryError;
  if (!response.ok) {
    const message = "message" in body ? body.message : "Unable to load analytics";
    throw new Error(message);
  }
  return body as AnalyticsSummaryResult;
}

export async function requestAnalyticsComparison(
  currentRange: DateRange,
  previousRange: DateRange,
  fetcher: AnalyticsFetcher = (url) => fetch(url),
): Promise<AnalyticsComparisonResult> {
  const [current, previous] = await Promise.all([
    requestAnalyticsSummary(currentRange.startDate, currentRange.endDate, fetcher),
    requestAnalyticsSummary(previousRange.startDate, previousRange.endDate, fetcher),
  ]);
  return { current, previous };
}

export function formatAnalyticsDelta(delta: AnalyticsMetricDelta): string {
  const absolute = delta.absolute > 0 ? `+${delta.absolute}` : `${delta.absolute}`;
  if (delta.percentage === null) return `New (${absolute})`;
  const percentage = delta.percentage > 0 ? `+${delta.percentage.toFixed(1)}` : delta.percentage.toFixed(1);
  return `${percentage}% (${absolute})`;
}

export function serializeAnalyticsCsv(days: readonly AnalyticsDayRow[]): string {
  const rows = days.map(({ date, views, likes, comments, estimatedMinutesWatched }) =>
    [date, views, likes, comments, estimatedMinutesWatched].join(","),
  );
  return [csvHeader, ...rows].join("\r\n");
}

function downloadCsv(days: readonly AnalyticsDayRow[]) {
  const url = URL.createObjectURL(new Blob([serializeAnalyticsCsv(days)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "tubemaster-analytics.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function AnalyticsDashboard() {
  const initialRange = useMemo(() => analyticsDateRangeForPreset("7"), []);
  const [preset, setPreset] = useState<Preset>("7");
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [comparison, setComparison] = useState<AnalyticsComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (range: DateRange) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const periods = calculatePeriodComparison(range.startDate, range.endDate);
      setComparison(await requestAnalyticsComparison(periods.current, periods.previous));
    } catch (error) {
      setComparison(null);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(initialRange);
  }, [initialRange, load]);

  const selectPreset = (next: Exclude<Preset, "custom">) => {
    const range = analyticsDateRangeForPreset(next);
    setPreset(next);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    void load(range);
  };

  const totals = useMemo(
    () => (comparison ? sumAnalyticsDays(comparison.current.days) : null),
    [comparison],
  );
  const previousTotals = useMemo(
    () => (comparison ? sumAnalyticsDays(comparison.previous.days) : null),
    [comparison],
  );
  const deltas = useMemo(
    () => (totals && previousTotals ? {
      views: calculateMetricDelta(totals.views, previousTotals.views),
      likes: calculateMetricDelta(totals.likes, previousTotals.likes),
      comments: calculateMetricDelta(totals.comments, previousTotals.comments),
      estimatedMinutesWatched: calculateMetricDelta(
        totals.estimatedMinutesWatched,
        previousTotals.estimatedMinutesWatched,
      ),
    } : null),
    [previousTotals, totals],
  );
  const metricCards: readonly [string, string, AnalyticsMetricDelta][] = totals && deltas ? [
    ["Views", totals.views.toLocaleString(), deltas.views],
    ["Likes", totals.likes.toLocaleString(), deltas.likes],
    ["Comments", totals.comments.toLocaleString(), deltas.comments],
    ["Minutes watched", totals.estimatedMinutesWatched.toLocaleString(undefined, { maximumFractionDigits: 1 }), deltas.estimatedMinutesWatched],
  ] : [];

  return (
    <section aria-labelledby="analytics-heading" className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <div>
        <h2 id="analytics-heading" className="text-xl font-semibold">Analytics</h2>
        <p className="mt-1 text-sm text-zinc-400">Review daily channel performance for a selected period.</p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" aria-label="Analytics period presets">
          {(["7", "30", "90"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={preset === value}
              onClick={() => selectPreset(value)}
              className={`rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${preset === value ? "bg-white text-zinc-950" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
            >
              Last {value} days
            </button>
          ))}
          <button
            type="button"
            aria-pressed={preset === "custom"}
            onClick={() => setPreset("custom")}
            className={`rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${preset === "custom" ? "bg-white text-zinc-950" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
          >
            Custom range
          </button>
        </div>

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setPreset("custom");
            void load({ startDate, endDate });
          }}
        >
          <label className="flex flex-col gap-1 text-sm text-zinc-300">
            From
            <input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-300">
            To
            <input type="date" value={endDate} max={formatDate(new Date())} onChange={(event) => setEndDate(event.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white" />
          </label>
          <button type="submit" className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            Apply range
          </button>
        </form>
      </div>

      {loading && <p role="status" className="text-sm text-zinc-400">Loading analytics...</p>}
      {errorMessage && <p role="alert" className="text-sm text-red-300">{errorMessage}</p>}

      {comparison && totals && previousTotals && deltas && !loading && (
        <>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
            Comparing {comparison.current.startDate}–{comparison.current.endDate} with {comparison.previous.startDate}–{comparison.previous.endDate}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metricCards.map(([label, value, delta]) => (
              <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
                <p className="mt-1 text-xs text-zinc-400">vs previous: {formatAnalyticsDelta(delta)}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Daily detail</h3>
            <button type="button" disabled={!comparison.current.days.length} onClick={() => downloadCsv(comparison.current.days)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50">
              Export CSV
            </button>
          </div>
          {comparison.current.days.length ? (
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">Daily analytics from {comparison.current.startDate} to {comparison.current.endDate}</caption>
                <thead className="bg-zinc-900 text-xs uppercase text-zinc-500">
                  <tr>{["Date", "Views", "Likes", "Comments", "Minutes watched"].map((heading) => <th key={heading} scope="col" className="px-4 py-3">{heading}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {comparison.current.days.map((day) => <tr key={day.date} className="text-zinc-300"><th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-white">{day.date}</th><td className="px-4 py-3">{day.views.toLocaleString()}</td><td className="px-4 py-3">{day.likes.toLocaleString()}</td><td className="px-4 py-3">{day.comments.toLocaleString()}</td><td className="px-4 py-3">{day.estimatedMinutesWatched.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-zinc-400">No analytics data for this period.</p>}
        </>
      )}
    </section>
  );
}
