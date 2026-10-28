"use client";

import { useState } from "react";
import { normalizeVideoId } from "./transcript-dashboard";
import { Button, Card, Input, Label } from "@/components/ui";

type SearchResult = {
  identity: string;
  videoId: string;
  chunkIndex: number;
  text: string;
  order: number;
  score: number;
};

function messageFor(status: number, fallback: string) {
  if (status === 401) return "Sign in to use semantic search.";
  if (status === 400) return fallback;
  return "Semantic search is unavailable right now. Check your OpenAI configuration and try again.";
}

export function SemanticSearchPage() {
  const [videoInput, setVideoInput] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState("5");
  const [indexing, setIndexing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [indexMessage, setIndexMessage] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);

  async function indexVideo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (indexing) return;
    const videoId = normalizeVideoId(videoInput);
    if (!videoId) {
      setIndexMessage("Enter a valid YouTube URL or 11-character video ID.");
      return;
    }
    setIndexing(true);
    setIndexMessage(null);
    try {
      const response = await fetch("/api/video-metadata/semantic-search/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      const payload = (await response.json()) as { message?: string; chunkCount?: number };
      if (!response.ok) throw new Error(messageFor(response.status, payload.message ?? "Unable to index this video."));
      setIndexMessage(`Indexed ${payload.chunkCount ?? 0} transcript chunks. You can search them now.`);
      setResults([]);
    } catch (error) {
      setIndexMessage(error instanceof Error ? error.message : "Unable to index this video.");
    } finally {
      setIndexing(false);
    }
  }

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searching) return;
    if (!query.trim()) {
      setSearchMessage("Enter a search query.");
      setResults([]);
      return;
    }
    setSearching(true);
    setSearchMessage(null);
    try {
      const response = await fetch("/api/video-metadata/semantic-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: Number(limit) }),
      });
      const payload = (await response.json()) as { message?: string; results?: SearchResult[] };
      if (!response.ok) throw new Error(messageFor(response.status, payload.message ?? "Unable to search transcripts."));
      setResults(payload.results ?? []);
    } catch (error) {
      setResults([]);
      setSearchMessage(error instanceof Error ? error.message : "Unable to search transcripts.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <main className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-wider text-rose">Transcript intelligence</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Semantic search</h1>
        <p className="mt-2 max-w-2xl text-sm text-subtle">
          Index a transcript with OpenAI embeddings, then search its meaning instead of matching exact words.
        </p>
      </div>

      <Card aria-labelledby="semantic-index-heading">
        <h2 id="semantic-index-heading" className="text-lg font-semibold text-fg">Index a video</h2>
        <p className="mt-1 text-sm text-subtle">Only the transcript is read. No YouTube content is modified.</p>
        <form onSubmit={indexVideo} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="semantic-video">YouTube URL or video ID</Label>
            <Input id="semantic-video" value={videoInput} onChange={(event) => setVideoInput(event.target.value)} disabled={indexing} placeholder="https://youtube.com/watch?v=..." className="mt-1 font-mono" />
          </div>
          <Button type="submit" disabled={indexing || !videoInput.trim()}>{indexing ? "Indexing..." : "Index video"}</Button>
        </form>
        {indexMessage && <p role="status" className="mt-4 rounded-panel border border-line bg-panel p-3 text-sm text-dim">{indexMessage}</p>}
      </Card>

      <Card aria-labelledby="semantic-search-heading">
        <h2 id="semantic-search-heading" className="text-lg font-semibold text-fg">Search indexed transcripts</h2>
        <form onSubmit={search} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="semantic-query">What do you want to find?</Label>
            <Input id="semantic-query" value={query} onChange={(event) => setQuery(event.target.value)} disabled={searching} placeholder="e.g. videos about changing a channel strategy" className="mt-1" />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="semantic-limit">Results</Label>
              <Input id="semantic-limit" type="number" min={1} max={20} value={limit} onChange={(event) => setLimit(event.target.value)} disabled={searching} className="mt-1 w-24" />
            </div>
            <Button type="submit" disabled={searching || !query.trim()}>{searching ? "Searching..." : "Search transcripts"}</Button>
          </div>
        </form>
        {searchMessage && <p role="alert" className="mt-4 rounded-panel border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{searchMessage}</p>}
        <div className="mt-6" aria-live="polite" aria-busy={searching}>
          {searching ? <p className="font-mono text-sm text-subtle">Searching indexed transcripts...</p> : results.length === 0 && !searchMessage ? <p role="status" className="text-sm text-subtle">No matches yet. Index a video and run a search.</p> : (
            <ol className="space-y-3">
              {results.map((result) => (
                <li key={result.identity} className="rounded-panel border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-subtle">
                    <span>{result.videoId} · chunk {result.chunkIndex}</span>
                    <span className="text-mint">score {result.score.toFixed(3)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-dim">{result.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
    </main>
  );
}
