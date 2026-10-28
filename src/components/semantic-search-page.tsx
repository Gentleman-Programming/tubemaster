"use client";

import { useState } from "react";
import { normalizeVideoId } from "./transcript-dashboard";
import { Button, Card, Input, Label } from "@/components/ui";

const pendingMessage = "Search model integration is pending. This page is ready for the provider decision.";

export function SemanticSearchPage() {
  const [videoInput, setVideoInput] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState("5");
  const [indexMessage, setIndexMessage] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  function indexVideo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

      <Card aria-labelledby="semantic-index-heading">
        <h2 id="semantic-index-heading" className="text-lg font-semibold text-fg">Index a video</h2>
        <p className="mt-1 text-sm text-subtle">The provider will be connected in the next implementation slice.</p>
        <form onSubmit={indexVideo} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="semantic-video">YouTube URL or video ID</Label>
            <Input id="semantic-video" value={videoInput} onChange={(event) => setVideoInput(event.target.value)} placeholder="https://youtube.com/watch?v=..." className="mt-1 font-mono" />
          </div>
          <Button type="submit" disabled={!videoInput.trim()}>Index video</Button>
        </form>
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
