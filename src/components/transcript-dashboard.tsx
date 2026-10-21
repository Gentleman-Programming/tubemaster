"use client";

import { useState } from "react";
import { formatTranscriptResult } from "./transcript-dashboard-format";
import type { TranscriptResult } from "@/lib/video-metadata/contracts";
import { Button, Card, Input, Label, Select } from "@/components/ui";

type Provider = "youtube-captions" | "yt-dlp";
type Transcript = TranscriptResult;

const fieldLabelClasses = "mb-1 block";
const errorClasses = "mt-4 rounded-panel border border-danger/30 bg-danger/10 p-3 text-sm text-danger";

export function normalizeVideoId(input: string): string | null {
  const value = input.trim();
  const validId = /^[a-zA-Z0-9_-]{11}$/;
  if (validId.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    let id: string | undefined;
    if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
      id = url.pathname === "/watch" ? url.searchParams.get("v") ?? undefined
        : /^\/(shorts|embed|live)\/[^/]+\/?$/.test(url.pathname) ? url.pathname.split("/")[2] : undefined;
    } else if (host === "youtu.be" || host === "www.youtu.be") {
      id = /^\/[^/]+\/?$/.test(url.pathname) ? url.pathname.split("/")[1] : undefined;
    }
    return id && validId.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function transcriptDisplayText(transcript: Transcript | null, error: string | null, loading: boolean): string | null {
  if (loading) return "Loading transcript...";
  if (error) return error;
  if (transcript?.status === "available") return `Available${transcript.language ? ` · ${transcript.language}` : ""}`;
  if (transcript?.status === "unavailable") return transcript.reason === "no-captions"
    ? "No captions are available for this video."
    : "The transcript is currently unavailable.";
  if (transcript?.status === "unsupported") return "This transcript provider is unsupported.";
  return null;
}

export async function requestTranscript(videoId: string, provider: Provider, fetcher: typeof fetch = fetch): Promise<Transcript> {
  const response = await fetcher("/api/video-metadata/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId, provider }),
  });
  if (response.status === 401) throw new Error("Sign in to use the transcript dashboard.");
  if (!response.ok) throw new Error("Unable to load transcript. Please try again.");
  const data: { transcript: Transcript } = await response.json();
  return data.transcript;
}

export function TranscriptDashboard() {
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<Provider>("youtube-captions");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const videoId = normalizeVideoId(input);
    setTranscript(null);
    if (!videoId) {
      setError("Enter a valid YouTube URL or 11-character video ID.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setTranscript(await requestTranscript(videoId, provider));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load transcript. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mb-8" aria-labelledby="transcript-heading">
      <h2 id="transcript-heading" className="mb-1 text-lg font-semibold text-fg">Transcript dashboard</h2>
      <p className="mb-4 text-sm text-subtle">Load a transcript using the provider that fits your video.</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="transcript-video" className={fieldLabelClasses}>YouTube URL or video ID</Label>
          <Input id="transcript-video" value={input} onChange={(event) => setInput(event.target.value)} disabled={loading} placeholder="https://youtube.com/watch?v=..." className="font-mono" />
        </div>
        <div>
          <Label htmlFor="transcript-provider" className={fieldLabelClasses}>Transcript provider</Label>
          <Select id="transcript-provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} disabled={loading}>
            <option value="youtube-captions">YouTube captions (OAuth)</option>
            <option value="yt-dlp">yt-dlp (public video)</option>
          </Select>
        </div>
        <Button type="submit" disabled={loading || !input.trim()}>
          {loading ? "Loading transcript..." : "Load transcript"}
        </Button>
      </form>
      <div aria-live="polite" aria-busy={loading}>
        {error && <p role="alert" className={errorClasses}>{error}</p>}
        {transcript?.status === "available" && <div className="mt-4 rounded-panel border border-line bg-panel p-3"><p className="mb-2 font-mono text-xs text-mint">{transcriptDisplayText(transcript, null, false)}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-sm text-dim">{formatTranscriptResult(transcript)}</pre></div>}
        {transcript?.status === "unavailable" && <p role="status" className="mt-4 rounded-panel border border-warn/30 bg-warn/10 p-3 text-sm text-warn">{transcriptDisplayText(transcript, null, false)}</p>}
        {transcript?.status === "unsupported" && <p role="alert" className={errorClasses}>{transcriptDisplayText(transcript, null, false)}</p>}
      </div>
    </Card>
  );
}
