"use client";

import { useEffect, useState } from "react";
import type { AnalyticsRetentionResult, AnalyticsRetentionRow } from "@/lib/youtube-analytics-summary";
import { Button, Card, EmptyState, FieldError, Input, Label, Select, SectionHeader } from "@/components/ui";

type Video = { videoId: string; title: string; publishedAt?: string };
type Fetcher = (url: string) => Promise<Response>;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateRangeForVideo(video: Video): { startDate: string; endDate: string } {
  const today = formatDate(new Date());
  const publishedDate = video.publishedAt?.slice(0, 10) || today;
  return { startDate: publishedDate > today ? today : publishedDate, endDate: today };
}

export async function requestVideoRetention(
  videoId: string,
  startDate: string,
  endDate: string,
  fetcher: Fetcher = (url) => fetch(url),
): Promise<AnalyticsRetentionResult> {
  const query = new URLSearchParams({ videoId, startDate, endDate });
  const response = await fetcher(`/api/youtube/analytics/retention?${query}`);
  const body = await response.json() as AnalyticsRetentionResult | { message?: string };
  if (!response.ok) throw new Error("message" in body && body.message ? body.message : "Unable to load video retention");
  return body as AnalyticsRetentionResult;
}

export function AnalyticsRetentionDashboard({ fetcher = (url) => fetch(url) }: { fetcher?: Fetcher }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [videoId, setVideoId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(formatDate(new Date()));
  const [retention, setRetention] = useState<AnalyticsRetentionResult | null>(null);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [loadingRetention, setLoadingRetention] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);

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
          setStartDate(range.startDate);
          setEndDate(range.endDate);
        }
      })
      .catch((error: unknown) => active && setVideoError(error instanceof Error ? error.message : "Unable to load channel videos"))
      .finally(() => active && setLoadingVideos(false));
    return () => { active = false; };
  }, [fetcher]);

  const loadRetention = async () => {
    if (!videoId || !startDate || !endDate) return;
    setLoadingRetention(true);
    setRetentionError(null);
    setRetention(null);
    try {
      setRetention(await requestVideoRetention(videoId, startDate, endDate, fetcher));
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
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void loadRetention(); }}>
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor="retention-video">Video</Label>
            <Select id="retention-video" aria-label="Select video" value={videoId} onChange={(event) => {
              const nextVideo = videos.find((video) => video.videoId === event.target.value);
              setVideoId(event.target.value);
              setRetentionError(null);
              if (nextVideo) {
                const range = dateRangeForVideo(nextVideo);
                setStartDate(range.startDate);
                setEndDate(range.endDate);
              }
            }}>
              {videos.map((video) => <option key={video.videoId} value={video.videoId}>{video.title}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="retention-start">From</Label>
            <Input id="retention-start" aria-label="Retention start date" type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="retention-end">To</Label>
            <Input id="retention-end" aria-label="Retention end date" type="date" value={endDate} max={formatDate(new Date())} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <Button type="submit" disabled={!videoId || !startDate || !endDate || loadingRetention}>Load retention</Button>
        </form>
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
