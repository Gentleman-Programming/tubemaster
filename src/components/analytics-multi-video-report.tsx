"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, Input } from "@/components/ui";
import type { AnalyticsReportResponse, AnalyticsReportResult, AnalyticsReportVideo } from "@/lib/youtube-analytics-summary";
import { serializeMultiVideoReportCsv, serializeMultiVideoReportJson } from "@/lib/reporting/multi-video-report";

type Fetcher = (url: string) => Promise<Response>;
type Video = AnalyticsReportVideo;

function formatMetric(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function downloadReport(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function requestMultiVideoReport(
  videoIds: readonly string[],
  startDate: string,
  endDate: string,
  fetcher: Fetcher = (url) => fetch(url),
): Promise<AnalyticsReportResult> {
  const query = new URLSearchParams({ startDate, endDate });
  for (const videoId of videoIds) query.append("videoId", videoId);
  const response = await fetcher(`/api/youtube/analytics/report?${query}`);
  const body = (await response.json()) as AnalyticsReportResponse;
  if (!response.ok || body.kind === "analytics-multi-video-report-error") {
    throw new Error(body.kind === "analytics-multi-video-report-error" ? body.message : "Unable to load analytics report");
  }
  return body;
}

export function AnalyticsMultiVideoReport() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 6);
    return date.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<AnalyticsReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/youtube/videos").then(async (response) => {
      const body = await response.json() as Video[] | { error?: string };
      if (!response.ok || !Array.isArray(body)) throw new Error("Unable to load channel videos");
      if (active) setVideos(body);
    }).catch(() => {
      if (active) setErrorMessage("Unable to load channel videos");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const selectedIds = useMemo(() => videos.filter((video) => selected.has(video.videoId)).map((video) => video.videoId), [selected, videos]);
  const toggleVideo = (videoId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(videoId)) next.delete(videoId);
      else if (next.size < 10) next.add(videoId);
      return next;
    });
  };
  const runReport = async () => {
    setReportLoading(true);
    setErrorMessage(null);
    try {
      setReport(await requestMultiVideoReport(selectedIds, startDate, endDate));
    } catch (error) {
      setReport(null);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load analytics report");
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <Card aria-labelledby="multi-video-report-heading" className="space-y-5">
      <div>
        <h2 id="multi-video-report-heading" className="text-xl font-semibold text-fg">Multi-video report</h2>
        <p className="mt-1 text-sm text-subtle">Compare read-only performance for up to ten videos in the selected period.</p>
      </div>
      {loading && <p role="status" className="font-mono text-sm text-subtle">Loading channel videos...</p>}
      {errorMessage && <p role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{errorMessage}</p>}
      {!loading && !videos.length && !errorMessage && <EmptyState title="No channel videos available." />}
      {!loading && videos.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-dim">From<Input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} className="font-mono" /></label>
            <label className="flex flex-col gap-1 text-sm font-medium text-dim">To<Input type="date" value={endDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setEndDate(event.target.value)} className="font-mono" /></label>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-dim">Videos ({selectedIds.length}/10; select at least 2)</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {videos.map((video) => <label key={video.videoId} className="flex items-start gap-2 rounded-control border border-line p-3 text-sm text-dim"><input type="checkbox" checked={selected.has(video.videoId)} onChange={() => toggleVideo(video.videoId)} /><span><span className="block font-medium text-fg">{video.title}</span><span className="font-mono text-xs text-muted">{video.videoId}</span></span></label>)}
            </div>
          </fieldset>
          <Button type="button" disabled={selectedIds.length < 2 || reportLoading} onClick={() => void runReport()}>{reportLoading ? "Loading report..." : "Build report"}</Button>
        </>
      )}
      {report && !reportLoading && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line-soft bg-glass px-4 py-3 text-sm text-dim"><span>Period <span className="font-mono text-fg">{report.startDate}–{report.endDate}</span></span><span className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => downloadReport("tubemaster-multi-video-report.json", serializeMultiVideoReportJson(report), "application/json")}>JSON</Button><Button variant="secondary" size="sm" onClick={() => downloadReport("tubemaster-multi-video-report.csv", serializeMultiVideoReportCsv(report), "text/csv;charset=utf-8")}>CSV</Button></span></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([["Views", report.totals.views], ["Likes", report.totals.likes], ["Comments", report.totals.comments], ["Minutes watched", report.totals.estimatedMinutesWatched]] as const).map(([label, value]) => <div key={label} className="rounded-panel border border-line bg-surface p-4"><p className="font-mono text-xs uppercase tracking-widest text-muted">{label}</p><p className="mt-2 font-mono text-2xl font-semibold text-fg">{formatMetric(value)}</p></div>)}</div>
          <div className="overflow-x-auto rounded-panel border border-line"><table className="min-w-full text-left text-sm"><caption className="sr-only">Multi-video analytics report</caption><thead className="bg-surface font-mono text-xs uppercase tracking-wider text-muted"><tr>{["Video", "Views", "Likes", "Comments", "Minutes watched", "Views delta"].map((heading) => <th key={heading} scope="col" className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead><tbody className="divide-y divide-line-soft">{report.videos.map((video) => <tr key={video.videoId} className="font-mono text-dim"><th scope="row" className="px-4 py-3 font-medium text-fg">{video.title}</th><td className="px-4 py-3">{formatMetric(video.current.views)}</td><td className="px-4 py-3">{formatMetric(video.current.likes)}</td><td className="px-4 py-3">{formatMetric(video.current.comments)}</td><td className="px-4 py-3">{formatMetric(video.current.estimatedMinutesWatched)}</td><td className="px-4 py-3">{video.deltas.views.absolute > 0 ? "+" : ""}{formatMetric(video.deltas.views.absolute)}</td></tr>)}</tbody></table></div>
        </>
      )}
    </Card>
  );
}
