"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeVideoId } from "./transcript-dashboard";
import { Button, Card, Input, Label } from "@/components/ui";

const pendingMessage = "Search model integration is pending. This page is ready for the provider decision.";

export type ChannelVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
};

function isChannelVideo(value: unknown): value is ChannelVideo {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.videoId === "string" && typeof item.title === "string" &&
    typeof item.description === "string" && typeof item.publishedAt === "string";
}

export function filterChannelVideos(videos: ChannelVideo[], query: string): ChannelVideo[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return videos;
  return videos.filter((video) => `${video.title} ${video.description}`.toLocaleLowerCase().includes(normalized));
}

export function selectAllVideoIds(videos: ChannelVideo[]): string[] {
  return videos.map((video) => video.videoId);
}

export async function loadChannelVideos(fetcher: typeof fetch = fetch): Promise<ChannelVideo[]> {
  const response = await fetcher("/api/youtube/videos");
  if (response.status === 401) throw new Error("Sign in to load videos from your channel.");
  if (!response.ok) throw new Error("Unable to load channel videos. Please try again.");
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.every(isChannelVideo)) {
    throw new Error("Invalid channel video response");
  }
  return payload;
}

export function SemanticSearchPage() {
  const [videoInput, setVideoInput] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState("5");
  const [indexMessage, setIndexMessage] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [channelVideos, setChannelVideos] = useState<ChannelVideo[]>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [videoFilter, setVideoFilter] = useState("");
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);

  async function refreshChannelVideos() {
    setVideoLoading(true);
    setVideoError(null);
    try {
      const videos = await loadChannelVideos();
      setChannelVideos(videos);
      setSelectedVideoIds((current) => current.filter((id) => videos.some((video) => video.videoId === id)));
    } catch (cause) {
      setVideoError(cause instanceof Error ? cause.message : "Unable to load channel videos. Please try again.");
    } finally {
      setVideoLoading(false);
    }
  }

  useEffect(() => {
    void refreshChannelVideos();
  }, []);

  const filteredVideos = useMemo(() => filterChannelVideos(channelVideos, videoFilter), [channelVideos, videoFilter]);
  const filteredIds = selectAllVideoIds(filteredVideos);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedVideoIds.includes(id));

  function toggleVideo(videoId: string) {
    setSelectedVideoIds((current) => current.includes(videoId)
      ? current.filter((id) => id !== videoId)
      : [...current, videoId]);
  }

  function toggleAllFiltered() {
    setSelectedVideoIds((current) => allFilteredSelected
      ? current.filter((id) => !filteredIds.includes(id))
      : [...new Set([...current, ...filteredIds])]);
  }

  function indexVideo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedVideoIds.length > 0) {
      setIndexMessage(`${pendingMessage} Selected videos: ${selectedVideoIds.length}.`);
      return;
    }
    if (!normalizeVideoId(videoInput)) {
      setIndexMessage("Enter a valid YouTube URL or 11-character video ID.");
      return;
    }
    setIndexMessage(pendingMessage);
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) {
      setSearchMessage("Enter a search query.");
      return;
    }
    setSearchMessage(`${pendingMessage} Requested result limit: ${limit}.`);
  }

  return (
    <main className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-wider text-rose">Transcript intelligence</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Semantic search</h1>
        <p className="mt-2 max-w-2xl text-sm text-subtle">
          Explore the semantic-search workflow while the embedding model integration is being selected.
        </p>
      </div>

      <Card aria-labelledby="semantic-channel-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="semantic-channel-heading" className="text-lg font-semibold text-fg">Select videos from your channel</h2>
            <p className="mt-1 text-sm text-subtle">Choose videos from the currently authenticated YouTube channel.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void refreshChannelVideos()} disabled={videoLoading}>
            {videoLoading ? "Loading videos..." : "Refresh videos"}
          </Button>
        </div>
        <div className="mt-4">
          <Label htmlFor="semantic-video-filter">Filter channel videos</Label>
          <Input id="semantic-video-filter" value={videoFilter} onChange={(event) => setVideoFilter(event.target.value)} placeholder="Search titles and descriptions" className="mt-1" />
        </div>
        <div className="mt-4" aria-live="polite" aria-busy={videoLoading}>
          {videoError && <p role="alert" className="rounded-panel border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{videoError}</p>}
          {!videoError && videoLoading && <p className="text-sm text-subtle">Loading videos from your channel...</p>}
          {!videoError && !videoLoading && channelVideos.length === 0 && <p className="text-sm text-subtle">No videos were found for the authenticated channel.</p>}
          {!videoError && !videoLoading && channelVideos.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft pb-3">
                <label className="flex items-center gap-2 text-sm text-dim">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} disabled={filteredVideos.length === 0} />
                  Select all visible ({filteredVideos.length})
                </label>
                <span className="font-mono text-xs text-subtle">Selected: {selectedVideoIds.length}</span>
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {filteredVideos.map((video) => (
                  <label key={video.videoId} className="flex cursor-pointer items-start gap-3 rounded-panel border border-line-soft bg-panel/40 p-3 hover:bg-glass">
                    <input type="checkbox" checked={selectedVideoIds.includes(video.videoId)} onChange={() => toggleVideo(video.videoId)} className="mt-1" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{video.title}</span>
                      <span className="mt-1 block font-mono text-xs text-subtle">{video.videoId} · {video.publishedAt}</span>
                    </span>
                  </label>
                ))}
                {filteredVideos.length === 0 && <p className="text-sm text-subtle">No channel videos match this filter.</p>}
              </div>
            </>
          )}
        </div>
      </Card>

      <Card aria-labelledby="semantic-index-heading">
        <h2 id="semantic-index-heading" className="text-lg font-semibold text-fg">Index selected videos</h2>
        <p className="mt-1 text-sm text-subtle">The embedding provider will be connected in the next implementation slice.</p>
        <form onSubmit={indexVideo} className="mt-4 space-y-3">
          <Button type="submit" disabled={selectedVideoIds.length === 0}>Index selected videos ({selectedVideoIds.length})</Button>
        </form>
        <div className="mt-5 border-t border-line-soft pt-4">
          <Label htmlFor="semantic-video">Manual YouTube URL or video ID</Label>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input id="semantic-video" value={videoInput} onChange={(event) => setVideoInput(event.target.value)} placeholder="https://youtube.com/watch?v=..." className="min-w-0 flex-1 font-mono" />
            <Button type="button" variant="secondary" onClick={() => {
              if (!normalizeVideoId(videoInput)) {
                setIndexMessage("Enter a valid YouTube URL or 11-character video ID.");
                return;
              }
              setIndexMessage(pendingMessage);
            }} disabled={!videoInput.trim()}>Index one video</Button>
          </div>
        </div>
        {indexMessage && <p role="status" className="mt-4 rounded-panel border border-line bg-panel p-3 text-sm text-dim">{indexMessage}</p>}
      </Card>

      <Card aria-labelledby="semantic-search-heading">
        <h2 id="semantic-search-heading" className="text-lg font-semibold text-fg">Search indexed transcripts</h2>
        <form onSubmit={search} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="semantic-query">What do you want to find?</Label>
            <Input id="semantic-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. videos about changing a channel strategy" className="mt-1" />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="semantic-limit">Results</Label>
              <Input id="semantic-limit" type="number" min={1} max={20} value={limit} onChange={(event) => setLimit(event.target.value)} className="mt-1 w-24" />
            </div>
            <Button type="submit" disabled={!query.trim()}>Search transcripts</Button>
          </div>
        </form>
        {searchMessage && <p role="status" className="mt-4 rounded-panel border border-line bg-panel p-3 text-sm text-dim">{searchMessage}</p>}
        <p className="mt-6 text-sm text-subtle">No search results are connected yet. Choose the embedding model and provider before wiring this workflow.</p>
      </Card>
    </main>
  );
}
