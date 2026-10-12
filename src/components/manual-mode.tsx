"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  selectLoadedVideos,
  serializeSelectedVideosCsv,
  serializeSelectedVideosJson,
} from "@/lib/reporting/selected-video-export";

type Video = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
};

type Playlist = { id: string; title: string };

type SubTab = "browse" | "batch";
type Action = "add" | "remove";

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
      <div className="flex gap-1 rounded-lg bg-zinc-800/50 p-1">
        <button
          onClick={() => setSubTab("browse")}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            subTab === "browse"
              ? "bg-zinc-700 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Browse Videos
        </button>
        <button
          onClick={() => setSubTab("batch")}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            subTab === "batch"
              ? "bg-zinc-700 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Batch (paste IDs)
        </button>
      </div>

      <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-zinc-400">
            Target Playlist
          </label>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-xs font-medium text-red-500 transition-colors hover:text-red-400"
          >
            {showCreate ? "Cancel" : "+ Create new"}
          </button>
        </div>

        {showCreate ? (
          <div className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="New playlist name..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm placeholder:text-zinc-600"
            />
            <div className="flex items-center gap-2">
              <select
                value={newPlaylistPrivacy}
                onChange={(e) =>
                  setNewPlaylistPrivacy(
                    e.target.value as "private" | "public" | "unlisted"
                  )
                }
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs"
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
              <button
                onClick={handleCreatePlaylist}
                disabled={creating || !newPlaylistName.trim()}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Playlist"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <select
              value={playlistId}
              onChange={(e) => {
                setPlaylistId(e.target.value);
                setCustomPlaylist("");
              }}
              disabled={loadingPlaylists}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm disabled:opacity-50"
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
            </select>

            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="h-px flex-1 bg-zinc-800" />
              <span>or paste Playlist ID/URL</span>
              <span className="h-px flex-1 bg-zinc-800" />
            </div>

            <input
              type="text"
              value={customPlaylist}
              onChange={(e) => {
                setCustomPlaylist(e.target.value);
                if (e.target.value.trim()) setPlaylistId("");
              }}
              placeholder="https://youtube.com/playlist?list=PL... or PLxxxxx"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm placeholder:text-zinc-600"
            />
          </>
        )}

        <div className="flex gap-1 rounded-lg bg-zinc-800/50 p-1">
          <button
            onClick={() => setAction("add")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              action === "add"
                ? "bg-green-600 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Add to playlist
          </button>
          <button
            onClick={() => setAction("remove")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              action === "remove"
                ? "bg-red-600 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Remove from playlist
          </button>
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || activeCount === 0 || !hasPlaylist}
          className={`w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
            action === "add"
              ? "bg-green-600 hover:bg-green-700"
              : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {loading
            ? action === "add"
              ? "Adding..."
              : "Removing..."
            : `${action === "add" ? "Add" : "Remove"} ${activeCount} video${activeCount !== 1 ? "s" : ""} ${action === "add" ? "to" : "from"} playlist`}
        </button>
      </div>

      {subTab === "batch" && (
        <div>
          <textarea
            value={batchIds}
            onChange={(e) => setBatchIds(e.target.value)}
            placeholder={`Paste video IDs or URLs, one per line or comma-separated:\n\ndQw4w9WgXcQ\nhttps://youtube.com/watch?v=dQw4w9WgXcQ\nhttps://youtu.be/dQw4w9WgXcQ`}
            rows={8}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm placeholder:text-zinc-600"
          />
          {batchIds && (
            <p className="mt-2 text-xs text-zinc-500">
              {batchCount} valid video ID{batchCount !== 1 ? "s" : ""} detected
            </p>
          )}
        </div>
      )}

      {subTab === "browse" && (
        <>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchVideos}
              disabled={loadingVideos}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              {loadingVideos
                ? "Loading all videos..."
                : videos.length > 0
                  ? "Refresh"
                  : "Load My Videos"}
            </button>
            <button
              type="button"
              onClick={() => downloadSelection("json")}
              disabled={selectedLoadedVideos.length === 0}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => downloadSelection("csv")}
              disabled={selectedLoadedVideos.length === 0}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              Export CSV
            </button>
            {videos.length > 0 && (
              <span className="text-sm text-zinc-400">
                {videos.length} total
                {selected.size > 0 && ` · ${selected.size} selected`}
              </span>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {videos.length > 0 && (
            <>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm placeholder:text-zinc-600"
              />

              <div className="rounded-xl border border-zinc-800 bg-zinc-900">
                <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    className="h-4 w-4 rounded accent-red-600"
                  />
                  <span className="text-sm font-medium text-zinc-400">
                    {search
                      ? `Select all ${filteredVideos.length} filtered`
                      : "Select all"}
                  </span>
                </div>

                <div className="max-h-[500px] overflow-y-auto">
                  {filteredVideos.map((video) => (
                    <label
                      key={video.videoId}
                      className="flex cursor-pointer items-center gap-3 border-b border-zinc-800/50 px-4 py-3 transition-colors hover:bg-zinc-800/50 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(video.videoId)}
                        onChange={() => toggleVideo(video.videoId)}
                        className="h-4 w-4 shrink-0 rounded accent-red-600"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {video.title}
                        </p>
                        <p className="text-xs text-zinc-500">
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
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm font-medium text-green-500">
            {result.added !== undefined
              ? `${result.added} video(s) added to playlist!`
              : `${result.removed} video(s) removed from playlist!`}
          </p>
        </div>
      )}
    </div>
  );
}
