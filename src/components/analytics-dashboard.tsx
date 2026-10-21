"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnalyticsDayRow,
  AnalyticsSummaryError,
  AnalyticsSummaryResult,
  AnalyticsTrafficSourceRow,
} from "@/lib/youtube-analytics-summary";
import {
  calculateMetricDelta,
  calculatePeriodComparison,
  sumAnalyticsDays,
  type AnalyticsDateRange,
  type AnalyticsMetricDelta,
} from "@/lib/youtube-analytics-summary/comparison";
import { cn } from "@/lib/cn";
import { Button, Card, EmptyState, Input } from "@/components/ui";

type Preset = "7" | "30" | "90" | "custom";
type DateRange = AnalyticsDateRange;
type AnalyticsFetcher = (url: string) => Promise<Response>;
type AnalyticsComparisonResult = {
  current: AnalyticsSummaryResult;
  previous: AnalyticsSummaryResult;
};

const csvHeader = "date,views,likes,comments,estimatedMinutesWatched";
const trafficSourceCsvHeader = "trafficSource,views,estimatedMinutesWatched";

const tableHeadClasses = "bg-surface font-mono text-xs uppercase tracking-wider text-muted";
const tableRowClasses = "font-mono text-dim transition-colors hover:bg-glass";

function presetClasses(active: boolean): string {
  return cn(
    "shrink-0 whitespace-nowrap rounded-control border px-2.5 py-1.5 font-mono text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose sm:px-3",
    active ? "border-rose/40 bg-rose/10 text-rose" : "border-transparent text-subtle hover:bg-glass-2 hover:text-fg",
  );
}

function deltaToneClass(delta: AnalyticsMetricDelta): string {
  if (delta.absolute > 0) return "text-mint";
  if (delta.absolute < 0) return "text-danger";
  return "text-subtle";
}

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

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeAnalyticsCsv(
  days: readonly AnalyticsDayRow[],
  trafficSources: readonly AnalyticsTrafficSourceRow[] = [],
): string {
  const rows = days.map(({ date, views, likes, comments, estimatedMinutesWatched }) =>
    [date, views, likes, comments, estimatedMinutesWatched].map(csvCell).join(","),
  );
  const sourceRows = trafficSources.map(({ sourceType, views, estimatedMinutesWatched }) =>
    [sourceType, views, estimatedMinutesWatched].map(csvCell).join(","),
  );
  return [csvHeader, ...rows, ...(sourceRows.length ? ["", trafficSourceCsvHeader, ...sourceRows] : [])].join("\r\n");
}

function downloadCsv(days: readonly AnalyticsDayRow[], trafficSources: readonly AnalyticsTrafficSourceRow[]) {
  const url = URL.createObjectURL(new Blob([serializeAnalyticsCsv(days, trafficSources)], { type: "text/csv;charset=utf-8" }));
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
  const trafficSources = comparison
    ? (() => {
        const previous = new Map(comparison.previous.trafficSources.map((row) => [row.sourceType, row]));
        return comparison.current.trafficSources.map((row) => ({
          ...row,
          delta: calculateMetricDelta(row.views, previous.get(row.sourceType)?.views ?? 0),
        }));
      })()
    : [];

  return (
    <Card aria-labelledby="analytics-heading" className="space-y-5">
      <div>
        <h2 id="analytics-heading" className="text-xl font-semibold text-fg">Analytics</h2>
        <p className="mt-1 text-sm text-subtle">Review daily channel performance for a selected period.</p>
      </div>

      <div className="space-y-4">
        <div
          className="flex max-w-full gap-0.5 overflow-x-auto rounded-panel border border-line bg-surface p-1 mask-r-from-90% sm:inline-flex sm:gap-1 sm:mask-none"
          aria-label="Analytics period presets"
        >
          {(["7", "30", "90"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={preset === value}
              onClick={() => selectPreset(value)}
              className={presetClasses(preset === value)}
            >
              Last {value} days
            </button>
          ))}
          <button
            type="button"
            aria-pressed={preset === "custom"}
            onClick={() => setPreset("custom")}
            className={presetClasses(preset === "custom")}
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
          <label className="flex flex-col gap-1 text-sm font-medium text-dim">
            From
            <Input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} className="font-mono" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-dim">
            To
            <Input type="date" value={endDate} max={formatDate(new Date())} onChange={(event) => setEndDate(event.target.value)} className="font-mono" />
          </label>
          <Button type="submit">Apply range</Button>
        </form>
      </div>

      {loading && <p role="status" className="font-mono text-sm text-subtle">Loading analytics...</p>}
      {errorMessage && <p role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{errorMessage}</p>}

      {comparison && totals && previousTotals && deltas && !loading && (
        <>
          <div className="rounded-panel border border-line-soft bg-glass px-4 py-3 text-sm text-dim">
            Comparing <span className="font-mono text-fg">{comparison.current.startDate}–{comparison.current.endDate}</span> with <span className="font-mono text-fg">{comparison.previous.startDate}–{comparison.previous.endDate}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metricCards.map(([label, value, delta]) => (
              <div key={label} className="rounded-panel border border-line bg-surface p-4">
                <p className="font-mono text-xs uppercase tracking-widest text-muted">{label}</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-fg">{value}</p>
                <p className="mt-1 font-mono text-xs text-subtle">
                  vs previous: <span className={deltaToneClass(delta)}>{formatAnalyticsDelta(delta)}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-fg">Daily detail</h3>
            <Button variant="secondary" size="sm" disabled={!comparison.current.days.length && !comparison.current.trafficSources.length} onClick={() => downloadCsv(comparison.current.days, comparison.current.trafficSources)}>
              Export CSV
            </Button>
          </div>
          {comparison.current.days.length ? (
            <div className="overflow-x-auto rounded-panel border border-line">
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">Daily analytics from {comparison.current.startDate} to {comparison.current.endDate}</caption>
                <thead className={tableHeadClasses}>
                  <tr>{["Date", "Views", "Likes", "Comments", "Minutes watched"].map((heading) => <th key={heading} scope="col" className="px-4 py-3 font-medium">{heading}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {comparison.current.days.map((day) => <tr key={day.date} className={tableRowClasses}><th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-fg">{day.date}</th><td className="px-4 py-3">{day.views.toLocaleString()}</td><td className="px-4 py-3">{day.likes.toLocaleString()}</td><td className="px-4 py-3">{day.comments.toLocaleString()}</td><td className="px-4 py-3">{day.estimatedMinutesWatched.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No analytics data for this period." />}

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-fg">Traffic sources</h3>
            {trafficSources.length ? (
              <div className="overflow-x-auto rounded-panel border border-line">
                <table className="min-w-full text-left text-sm">
                  <caption className="sr-only">Traffic sources for the selected period</caption>
                  <thead className={tableHeadClasses}>
                    <tr>{["Source", "Views", "Minutes watched", "vs previous"].map((heading) => <th key={heading} scope="col" className="px-4 py-3 font-medium">{heading}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {trafficSources.map((source) => <tr key={source.sourceType} className={tableRowClasses}><th scope="row" className="px-4 py-3 font-medium text-fg">{source.sourceType}</th><td className="px-4 py-3">{source.views.toLocaleString()}</td><td className="px-4 py-3">{source.estimatedMinutesWatched.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td><td className={cn("px-4 py-3", deltaToneClass(source.delta))}>{formatAnalyticsDelta(source.delta)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No traffic-source data for this period." />}
          </div>
        </>
      )}
    </Card>
  );
}
