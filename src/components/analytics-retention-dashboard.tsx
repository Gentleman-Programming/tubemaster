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
      {retention && !loadingRetention && (retention.rows.length ? <RetentionTable rows={retention.rows} /> : <EmptyState title="No retention data" description="YouTube returned no audience-retention rows for this video and date range." />)}
    </Card>
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
