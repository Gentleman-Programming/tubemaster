"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  selectLoadedVideos,
  serializeSelectedVideosCsv,
  serializeSelectedVideosJson,
} from "@/lib/reporting/selected-video-export";
import { cn } from "@/lib/cn";
import { Button, Card, Input, Select, Textarea } from "@/components/ui";

type Video = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
};

type Playlist = { id: string; title: string };

type SubTab = "browse" | "batch";
type Action = "add" | "remove";

const segmentedGroupClasses = "flex gap-1 rounded-panel border border-line bg-surface p-1";

function segmentClasses(active: boolean): string {
  return cn(
    "rounded-control border px-3 py-1.5 font-mono text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose",
    active ? "border-rose/40 bg-rose/10 text-rose" : "border-transparent text-subtle hover:bg-glass-2 hover:text-fg",
  );
}

export function ManualMode() {
  const [subTab, setSubTab] = useState<SubTab>("browse");
  const [action, setAction] = useState<Action>("add");
  const [videos, setVideos] = useState<Video[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playlistId, setPlaylistId] = useState("");
  const [customPlaylist, setCustomPlaylist] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [result, setResult] = useState<
    { added?: number; removed?: number } | null
  >(null);
  const [batchIds, setBatchIds] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistPrivacy, setNewPlaylistPrivacy] = useState<
    "private" | "public" | "unlisted"
  >("private");
  const [creating, setCreating] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    setLoadingPlaylists(true);
    try {
      const res = await fetch("/api/youtube/playlists");
      const data = await res.json();
      if (Array.isArray(data)) setPlaylists(data);
    } finally {
      setLoadingPlaylists(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  async function handleCreatePlaylist() {
    if (!newPlaylistName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/youtube/create-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newPlaylistName.trim(),
          privacyStatus: newPlaylistPrivacy,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPlaylists((prev) => [data, ...prev]);
        setPlaylistId(data.id);
        setCustomPlaylist("");
        setNewPlaylistName("");
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  }

  async function fetchVideos() {
    setLoadingVideos(true);
    setError(null);
    try {
      const res = await fetch("/api/youtube/videos");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
        return;
      }
      setVideos(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingVideos(false);
    }
  }

  function toggleVideo(videoId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  }

  const selectedLoadedVideos = useMemo(
    () => selectLoadedVideos(videos, selected),
    [videos, selected]
  );

  function downloadSelection(format: "json" | "csv") {
    if (selectedLoadedVideos.length === 0) return;
    const content = format === "json"
      ? serializeSelectedVideosJson(selectedLoadedVideos)
      : serializeSelectedVideosCsv(selectedLoadedVideos);
    const mime = format === "json" ? "application/json" : "text/csv";
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `tubemaster-selected-videos.${format}`;
    link.click();
    // Let the browser start the download before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const filteredVideos = useMemo(() => {
    if (!search.trim()) return videos;
    const q = search.toLowerCase();
    return videos.filter((v) => v.title.toLowerCase().includes(q));
  }, [videos, search]);

  function toggleAllFiltered() {
    const allSelected = filteredVideos.every((v) => selected.has(v.videoId));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        filteredVideos.forEach((v) => next.delete(v.videoId));
      } else {
        filteredVideos.forEach((v) => next.add(v.videoId));
      }
      return next;
    });
  }

  function parseVideoIds(input: string): string[] {
    return input
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .map((s) => {
        const urlMatch = s.match(
          /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/
        );
        if (urlMatch) return urlMatch[1];
        if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
        return "";
      })
      .filter(Boolean);
  }

  function resolvePlaylistId(input: string): string {
    const trimmed = input.trim();
    const match = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : trimmed;
  }

  async function handleSubmit() {
    const videoIds =
      subTab === "batch" ? parseVideoIds(batchIds) : Array.from(selected);

    const targetPlaylist = customPlaylist.trim()
      ? resolvePlaylistId(customPlaylist)
      : playlistId;

    if (videoIds.length === 0 || !targetPlaylist) return;
    setLoading(true);
    setResult(null);

    const endpoint =
      action === "add"
        ? "/api/youtube/add-to-playlist"
        : "/api/youtube/remove-from-playlist";

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoIds, playlistId: targetPlaylist }),
    });

    const data = await res.json();
    setResult(
      action === "add" ? { added: data.added } : { removed: data.removed }
    );
    if (subTab === "browse") setSelected(new Set());
    if (subTab === "batch") setBatchIds("");
    setLoading(false);
  }

  const batchCount = parseVideoIds(batchIds).length;
  const activeCount = subTab === "batch" ? batchCount : selected.size;
  const hasPlaylist = !!(customPlaylist.trim() || playlistId);
  const allFilteredSelected =
    filteredVideos.length > 0 &&
    filteredVideos.every((v) => selected.has(v.videoId));

  return (
    <div className="space-y-4">
      <div className={segmentedGroupClasses}>
        <button
          onClick={() => setSubTab("browse")}
          className={segmentClasses(subTab === "browse")}
        >
          Browse Videos
        </button>
        <button
          onClick={() => setSubTab("batch")}
          className={segmentClasses(subTab === "batch")}
        >
          Batch (paste IDs)
        </button>
      </div>

      <Card as="div" className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="font-mono text-xs font-medium uppercase tracking-wider text-subtle">
            Target Playlist
          </label>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-control px-2 py-1 font-mono text-xs font-medium text-rose transition-colors hover:bg-glass-2 hover:text-pink"
          >
            {showCreate ? "Cancel" : "+ Create new"}
          </button>
        </div>

        {showCreate ? (
          <div className="space-y-2 rounded-panel border border-line bg-glass p-3">
            <Input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="New playlist name..."
            />
            <div className="flex items-center gap-2">
              <div className="w-36 shrink-0">
              <Select
                value={newPlaylistPrivacy}
                onChange={(e) =>
                  setNewPlaylistPrivacy(
                    e.target.value as "private" | "public" | "unlisted"
                  )
                }
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </Select>
              </div>
              <Button
                onClick={handleCreatePlaylist}
                disabled={creating || !newPlaylistName.trim()}
              >
                {creating ? "Creating..." : "Create Playlist"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Select
              value={playlistId}
              onChange={(e) => {
                setPlaylistId(e.target.value);
                setCustomPlaylist("");
              }}
              disabled={loadingPlaylists}
            >
              <option value="">
                {loadingPlaylists
                  ? "Loading playlists..."
                  : `Select from ${playlists.length} playlists...`}
              </option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>

            <div className="flex items-center gap-2 font-mono text-xs text-muted">
              <span className="h-px flex-1 bg-line" />
              <span>or paste Playlist ID/URL</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <Input
              type="text"
              value={customPlaylist}
              onChange={(e) => {
                setCustomPlaylist(e.target.value);
                if (e.target.value.trim()) setPlaylistId("");
              }}
              placeholder="https://youtube.com/playlist?list=PL... or PLxxxxx"
              className="font-mono"
            />
          </>
        )}

        <div className={segmentedGroupClasses}>
          <button
            onClick={() => setAction("add")}
            className={cn("flex-1", segmentClasses(action === "add"))}
          >
            Add to playlist
          </button>
          <button
            onClick={() => setAction("remove")}
            className={cn("flex-1", segmentClasses(action === "remove"))}
          >
            Remove from playlist
          </button>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={loading || activeCount === 0 || !hasPlaylist}
          variant={action === "add" ? "primary" : "danger"}
          className="w-full"
        >
          {loading
            ? action === "add"
              ? "Adding..."
              : "Removing..."
            : `${action === "add" ? "Add" : "Remove"} ${activeCount} video${activeCount !== 1 ? "s" : ""} ${action === "add" ? "to" : "from"} playlist`}
        </Button>
      </Card>

      {subTab === "batch" && (
        <div>
          <Textarea
            value={batchIds}
            onChange={(e) => setBatchIds(e.target.value)}
            placeholder={`Paste video IDs or URLs, one per line or comma-separated:\n\ndQw4w9WgXcQ\nhttps://youtube.com/watch?v=dQw4w9WgXcQ\nhttps://youtu.be/dQw4w9WgXcQ`}
            rows={8}
            className="font-mono"
          />
          {batchIds && (
            <p className="mt-2 font-mono text-xs text-subtle">
              {batchCount} valid video ID{batchCount !== 1 ? "s" : ""} detected
            </p>
          )}
        </div>
      )}

      {subTab === "browse" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={fetchVideos}
              disabled={loadingVideos}
            >
              {loadingVideos
                ? "Loading all videos..."
                : videos.length > 0
                  ? "Refresh"
                  : "Load My Videos"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadSelection("json")}
              disabled={selectedLoadedVideos.length === 0}
            >
              Export JSON
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadSelection("csv")}
              disabled={selectedLoadedVideos.length === 0}
            >
              Export CSV
            </Button>
            {videos.length > 0 && (
              <span className="font-mono text-sm text-subtle">
                {videos.length} total
                {selected.size > 0 && ` · ${selected.size} selected`}
              </span>
            )}
          </div>

          {error && (
            <div className="rounded-panel border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {error}
            </div>
          )}

          {videos.length > 0 && (
            <>
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title..."
              />

              <div className="overflow-hidden rounded-card border border-line bg-surface-2">
                <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    className="h-4 w-4 rounded accent-rose"
                  />
                  <span className="text-sm font-medium text-subtle">
                    {search
                      ? `Select all ${filteredVideos.length} filtered`
                      : "Select all"}
                  </span>
                </div>

                <div className="max-h-[500px] overflow-y-auto">
                  {filteredVideos.map((video) => (
                    <label
                      key={video.videoId}
                      className="flex cursor-pointer items-center gap-3 border-b border-line-soft px-4 py-3 transition-colors hover:bg-glass-2 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(video.videoId)}
                        onChange={() => toggleVideo(video.videoId)}
                        className="h-4 w-4 shrink-0 rounded accent-rose"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">
                          {video.title}
                        </p>
                        <p className="font-mono text-xs text-muted">
                          {new Date(video.publishedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {result && (
        <div className="rounded-panel border border-mint/30 bg-mint/10 p-4">
          <p className="font-mono text-sm font-medium text-mint">
            {result.added !== undefined
              ? `${result.added} video(s) added to playlist!`
              : `${result.removed} video(s) removed from playlist!`}
          </p>
        </div>
      )}
    </div>
  );
}
