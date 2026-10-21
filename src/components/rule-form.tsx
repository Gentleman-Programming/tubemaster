"use client";

import { useState, useEffect } from "react";
import { Button, CardTitle, Input, Label, Select } from "@/components/ui";

type Playlist = { id: string; title: string };

export function RuleForm({ onCreated }: { onCreated: () => void }) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    matchField: "title",
    matchType: "contains",
    matchValue: "",
    playlistId: "",
  });

  useEffect(() => {
    fetch("/api/youtube/playlists")
      .then((r) => r.json())
      .then(setPlaylists);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const playlist = playlists.find((p) => p.id === form.playlistId);

    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        playlistTitle: playlist?.title ?? "",
      }),
    });

    setForm({
      name: "",
      matchField: "title",
      matchType: "contains",
      matchValue: "",
      playlistId: "",
    });
    setLoading(false);
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-card border border-line bg-surface-2 p-5">
      <CardTitle className="mb-4">New Rule</CardTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="mb-1 block">Rule Name</Label>
          <Input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder='e.g. "Podcasts to playlist"'
          />
        </div>

        <div>
          <Label className="mb-1 block">Match Field</Label>
          <Select
            value={form.matchField}
            onChange={(e) => setForm({ ...form, matchField: e.target.value })}
          >
            <option value="title">Title</option>
            <option value="description">Description</option>
          </Select>
        </div>

        <div>
          <Label className="mb-1 block">Match Type</Label>
          <Select
            value={form.matchType}
            onChange={(e) => setForm({ ...form, matchType: e.target.value })}
          >
            <option value="contains">Contains</option>
            <option value="startsWith">Starts With</option>
            <option value="endsWith">Ends With</option>
            <option value="equals">Equals</option>
          </Select>
        </div>

        <div>
          <Label className="mb-1 block">Match Value</Label>
          <Input
            type="text"
            required
            value={form.matchValue}
            onChange={(e) => setForm({ ...form, matchValue: e.target.value })}
            placeholder='e.g. "Podcast"'
          />
        </div>

        <div>
          <Label className="mb-1 block">
            Target Playlist
          </Label>
          <Select
            required
            value={form.playlistId}
            onChange={(e) => setForm({ ...form, playlistId: e.target.value })}
          >
            <option value="">Select a playlist...</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="mt-4">
        {loading ? "Creating..." : "Create Rule"}
      </Button>
    </form>
  );
}
