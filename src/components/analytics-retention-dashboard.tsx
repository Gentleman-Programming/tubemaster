"use client";

import { useEffect, useState } from "react";
import type { AnalyticsRetentionResult, AnalyticsRetentionRow } from "@/lib/youtube-analytics-summary";
import { Button, Card, EmptyState, FieldError, Input, Label, Select, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Video = { videoId: string; title: string; publishedAt?: string };
type Fetcher = (url: string) => Promise<Response>;
type RetentionPreset = "custom" | "7" | "30" | "90";

export const defaultRetentionFetcher: Fetcher = (url) => fetch(url);

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateRangeForPreset(
  preset: Exclude<RetentionPreset, "custom">,
  now = new Date(),
  publishedAt?: string,
): { startDate: string; endDate: string } {
  const today = formatDate(now);
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (Number(preset) - 1));
  const publishedDate = publishedAt?.slice(0, 10);
  const startDate = publishedDate && publishedDate > formatDate(start) ? publishedDate : formatDate(start);
  return { startDate: startDate > today ? today : startDate, endDate: today };
}

function dateRangeForVideo(video: Video): { startDate: string; endDate: string } {
  return dateRangeForPreset("90", new Date(), video.publishedAt);
}

export function retentionChartSeries(rows: readonly AnalyticsRetentionRow[]): AnalyticsRetentionRow[] {
  return [...rows].sort((a, b) => a.elapsedVideoTimeRatio - b.elapsedVideoTimeRatio);
}

function presetClasses(active: boolean): string {
  return cn(
    "shrink-0 whitespace-nowrap rounded-control border px-2.5 py-1.5 font-mono text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose sm:px-3",
    active ? "border-rose/40 bg-rose/10 text-rose" : "border-transparent text-subtle hover:bg-glass-2 hover:text-fg",
  );
}

export function validateRetentionDateRange(startDate: string, endDate: string, today = formatDate(new Date())): string | null {
  if (!startDate || !endDate) return null;
  if (startDate > endDate) return "From date must be on or before To date";
  if (endDate > today) return "To date cannot be in the future";
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if ((end.getTime() - start.getTime()) / 86400000 + 1 > 90) return "Range exceeds 90 days";
  return null;
}

export async function requestVideoRetention(
  videoId: string,
  startDate: string,
  endDate: string,
  fetcher: Fetcher = defaultRetentionFetcher,
): Promise<AnalyticsRetentionResult> {
  const query = new URLSearchParams({ videoId, startDate, endDate });
  const response = await fetcher(`/api/youtube/analytics/retention?${query}`);
  const body = await response.json() as AnalyticsRetentionResult | { message?: string };
  if (!response.ok) throw new Error("message" in body && body.message ? body.message : "Unable to load video retention");
  return body as AnalyticsRetentionResult;
}

export function AnalyticsRetentionDashboard({ fetcher = defaultRetentionFetcher }: { fetcher?: Fetcher }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [videoId, setVideoId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(formatDate(new Date()));
  const [preset, setPreset] = useState<RetentionPreset>("90");
  const [retention, setRetention] = useState<AnalyticsRetentionResult | null>(null);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [loadingRetention, setLoadingRetention] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const dateError = validateRetentionDateRange(startDate, endDate);

  useEffect(() => {
    let active = true;
    void fetcher("/api/youtube/videos")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load channel videos");
        return response.json() as Promise<Video[]>;
      })
      .then((items) => {
        if (!active) return;
        setVideoError(null);
        setVideos(items);
        setVideoId(items[0]?.videoId ?? "");
        if (items[0]) {
          const range = dateRangeForVideo(items[0]);
          setPreset("90");
          setStartDate(range.startDate);
          setEndDate(range.endDate);
        }
      })
      .catch((error: unknown) => active && setVideoError(error instanceof Error ? error.message : "Unable to load channel videos"))
      .finally(() => active && setLoadingVideos(false));
    return () => { active = false; };
  }, [fetcher]);

  const loadRetention = async (range = { startDate, endDate }) => {
    if (!videoId || !range.startDate || !range.endDate) return;
    const nextDateError = validateRetentionDateRange(range.startDate, range.endDate);
    if (nextDateError) {
      setRetentionError(nextDateError);
      return;
    }
    setLoadingRetention(true);
    setRetentionError(null);
    setRetention(null);
    try {
      setRetention(await requestVideoRetention(videoId, range.startDate, range.endDate, fetcher));
    } catch (error) {
      setRetentionError(error instanceof Error ? error.message : "Unable to load video retention");
    } finally {
      setLoadingRetention(false);
    }
  };

  return (
    <Card aria-labelledby="retention-heading" className="space-y-5">
      <SectionHeader
        title={<span id="retention-heading">Video retention</span>}
        description="Select one channel video to inspect audience retention."
      />
      {loadingVideos && <p role="status" className="font-mono text-sm text-subtle">Loading channel videos…</p>}
      {!loadingVideos && !videos.length && !videoError && (
        <EmptyState title="No channel videos available" description="Load a channel video before requesting audience retention." />
      )}
      {videoError && !videos.length && <FieldError>{videoError}</FieldError>}
      {videos.length > 0 && (
        <div className="space-y-4">
          <div className="min-w-64 space-y-1">
            <Label htmlFor="retention-video">Video</Label>
            <Select id="retention-video" aria-label="Select video" value={videoId} onChange={(event) => {
              const nextVideo = videos.find((video) => video.videoId === event.target.value);
              setVideoId(event.target.value);
              setRetentionError(null);
              if (nextVideo) {
                const range = dateRangeForVideo(nextVideo);
                setPreset("90");
                setStartDate(range.startDate);
                setEndDate(range.endDate);
              }
            }}>
              {videos.map((video) => <option key={video.videoId} value={video.videoId}>{video.title}</option>)}
            </Select>
          </div>
          <div className="space-y-4">
            <div
              className="flex max-w-full gap-0.5 overflow-x-auto rounded-panel border border-line bg-surface p-1 mask-r-from-90% sm:inline-flex sm:gap-1 sm:mask-none"
              aria-label="Retention period presets"
            >
              {(["7", "30", "90"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={preset === value}
                  onClick={() => {
                    const nextVideo = videos.find((video) => video.videoId === videoId);
                    const range = dateRangeForPreset(value, new Date(), nextVideo?.publishedAt);
                    setPreset(value);
                    setStartDate(range.startDate);
                    setEndDate(range.endDate);
                    void loadRetention(range);
                  }}
                  className={presetClasses(preset === value)}
                >
                  Last {value} days
                </button>
              ))}
              <button type="button" aria-pressed={preset === "custom"} onClick={() => setPreset("custom")} className={presetClasses(preset === "custom")}>Custom range</button>
            </div>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => { event.preventDefault(); void loadRetention(); }}
            >
              <label className="flex flex-col gap-1 text-sm font-medium text-dim">
                From
                <Input id="retention-start" aria-label="Retention start date" type="date" value={startDate} max={endDate} onChange={(event) => { setPreset("custom"); setRetentionError(null); setStartDate(event.target.value); }} className="font-mono" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-dim">
                To
                <Input id="retention-end" aria-label="Retention end date" type="date" value={endDate} max={formatDate(new Date())} onChange={(event) => { setPreset("custom"); setRetentionError(null); setEndDate(event.target.value); }} className="font-mono" />
              </label>
              <Button type="submit" disabled={!videoId || !startDate || !endDate || Boolean(dateError) || loadingRetention}>Apply range</Button>
              {dateError && <FieldError>{dateError}</FieldError>}
            </form>
          </div>
        </div>
      )}
      {loadingRetention && <p role="status" className="font-mono text-sm text-subtle">Loading video retention…</p>}
      {retentionError && <FieldError>{retentionError}</FieldError>}
      {retention && !loadingRetention && (retention.rows.length ? (
        <>
          <RetentionChart rows={retention.rows} />
          <RetentionTable rows={retention.rows} />
        </>
      ) : <EmptyState title="No retention data" description="YouTube returned no audience-retention rows for this video and date range." />)}
    </Card>
  );
}

function RetentionChart({ rows }: { rows: readonly AnalyticsRetentionRow[] }) {
  const series = retentionChartSeries(rows);
  const width = 720;
  const height = 320;
  const left = 48;
  const right = 52;
  const top = 28;
  const bottom = 44;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const relativeValues = series.map((row) => row.relativeRetentionPerformance);
  const relativeMin = Math.min(...relativeValues);
  const relativeMax = Math.max(...relativeValues);
  const relativeSpan = relativeMax - relativeMin || 1;
  const x = (value: number) => left + value * plotWidth;
  const audienceY = (value: number) => top + (1 - value) * plotHeight;
  const relativeY = (value: number) => top + (1 - (value - relativeMin) / relativeSpan) * plotHeight;
  const audiencePoints = series.map((row) => `${x(row.elapsedVideoTimeRatio)},${audienceY(row.audienceWatchRatio)}`).join(" ");
  const relativePoints = series.map((row) => `${x(row.elapsedVideoTimeRatio)},${relativeY(row.relativeRetentionPerformance)}`).join(" ");
  const chartId = "retention-chart";

  return (
    <figure className="space-y-3 rounded-panel border border-line bg-surface p-4" aria-labelledby={`${chartId}-title`}>
      <figcaption id={`${chartId}-title`} className="text-sm font-semibold text-fg">Audience retention curve</figcaption>
      <p id={`${chartId}-description`} className="sr-only">Audience watch ratio and relative retention performance plotted against elapsed video time.</p>
      <svg className="h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${chartId}-title ${chartId}-description`}>
        {[0, 0.5, 1].map((value) => (
          <line key={value} x1={left} x2={width - right} y1={audienceY(value)} y2={audienceY(value)} stroke="currentColor" className="text-line" strokeDasharray="3 5" />
        ))}
        <line x1={left} x2={left} y1={top} y2={height - bottom} stroke="currentColor" className="text-muted" />
        <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} stroke="currentColor" className="text-muted" />
        <polyline points={audiencePoints} fill="none" stroke="currentColor" className="text-rose" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={relativePoints} fill="none" stroke="currentColor" className="text-mint" strokeWidth="3" strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" />
        {series.map((row) => (
          <g key={row.elapsedVideoTimeRatio}>
            <circle cx={x(row.elapsedVideoTimeRatio)} cy={audienceY(row.audienceWatchRatio)} r="4" fill="currentColor" className="text-rose">
              <title>{`${(row.elapsedVideoTimeRatio * 100).toFixed(0)}% elapsed: ${(row.audienceWatchRatio * 100).toFixed(1)}% audience watch ratio`}</title>
            </circle>
            <circle cx={x(row.elapsedVideoTimeRatio)} cy={relativeY(row.relativeRetentionPerformance)} r="4" fill="currentColor" className="text-mint">
              <title>{`${(row.elapsedVideoTimeRatio * 100).toFixed(0)}% elapsed: ${row.relativeRetentionPerformance.toFixed(2)} relative retention`}</title>
            </circle>
          </g>
        ))}
        <text x={left} y={height - 12} className="fill-muted font-mono text-[11px]">0%</text>
        <text x={width - right} y={height - 12} textAnchor="end" className="fill-muted font-mono text-[11px]">100% elapsed</text>
        <text x={left - 8} y={top + 4} textAnchor="end" className="fill-muted font-mono text-[11px]">100%</text>
        <text x={left - 8} y={height - bottom + 4} textAnchor="end" className="fill-muted font-mono text-[11px]">0%</text>
        <text x={width - right + 8} y={top + 4} className="fill-mint font-mono text-[11px]">{relativeMax.toFixed(2)}</text>
        <text x={width - right + 8} y={height - bottom + 4} className="fill-mint font-mono text-[11px]">{relativeMin.toFixed(2)}</text>
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-subtle" aria-label="Retention chart legend">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-rose" aria-hidden="true" />Audience watch ratio</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-mint" aria-hidden="true" />Relative retention performance</span>
      </div>
    </figure>
  );
}

function RetentionTable({ rows }: { rows: readonly AnalyticsRetentionRow[] }) {
  return (
    <div className="overflow-x-auto rounded-panel border border-line">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Audience retention by elapsed video time</caption>
        <thead className="bg-surface text-xs uppercase tracking-wider text-muted"><tr>{["Elapsed video time", "Audience watch ratio", "Relative retention"].map((heading) => <th key={heading} scope="col" className="px-4 py-3">{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{rows.map((row) => <tr key={row.elapsedVideoTimeRatio} className="text-dim"><th scope="row" className="px-4 py-3 font-medium text-fg">{(row.elapsedVideoTimeRatio * 100).toFixed(0)}%</th><td className="px-4 py-3">{(row.audienceWatchRatio * 100).toFixed(1)}%</td><td className="px-4 py-3">{row.relativeRetentionPerformance.toFixed(2)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
