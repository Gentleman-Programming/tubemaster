"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { nextChannelThumbnail } from "@/components/channel-thumbnail";

type ChannelInfo = {
  id: string;
  title: string;
  thumbnail?: string;
  thumbnailCandidates?: string[];
  videoCount?: string;
};
type ChannelState =
  | { status: "loading" | "empty" | "error" }
  | { status: "ready"; channel: ChannelInfo };

export function DashboardHeader() {
  const { data: session } = useSession();
  const [channelState, setChannelState] = useState<ChannelState>({ status: "loading" });
  const [failedThumbnail, setFailedThumbnail] = useState<string | undefined>();
  const channel = channelState.status === "ready" ? channelState.channel : null;
  const candidates = channel
    ? channel.thumbnailCandidates ?? (channel.thumbnail ? [channel.thumbnail] : [])
    : [];
  const thumbnail = failedThumbnail === undefined
    ? candidates[0]
    : nextChannelThumbnail(candidates, failedThumbnail);

  const fetchChannel = useCallback(async () => {
    setChannelState({ status: "loading" });
    setFailedThumbnail(undefined);
    try {
      const res = await fetch("/api/youtube/channel-info");
      if (!res.ok) throw new Error("Channel request failed");
      const data: { channel: ChannelInfo | null } = await res.json();
      setChannelState(data.channel
        ? { status: "ready", channel: data.channel }
        : { status: "empty" });
    } catch {
      setChannelState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    if (session) queueMicrotask(() => { void fetchChannel(); });
  }, [session, fetchChannel]);

  async function handleSwitchChannel() {
    await signOut({ redirect: false });
    await signIn("google");
  }

  return (
    <header className="space-y-5 border-b border-zinc-800 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xl font-bold">YouTube Playlist Manager</p>
          <p className="text-sm text-zinc-400">Welcome, {session?.user?.name}</p>
        </div>
        <button onClick={() => signOut()} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          Sign Out
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="flex items-center gap-3">
          {thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} onError={() => setFailedThumbnail(thumbnail)} alt={channel?.title ?? "Channel"} className="h-10 w-10 rounded-full" />
          )}
          <div>
            <p className="text-xs text-zinc-500">Active YouTube channel</p>
            <p className="font-medium">
              {channel?.title ?? (channelState.status === "loading" ? "Loading..." : channelState.status === "empty" ? "No channel found" : "Unable to load channel")}
              {channel?.videoCount && <span className="ml-2 text-xs text-zinc-500">{channel.videoCount} videos</span>}
            </p>
          </div>
        </div>
        <button onClick={handleSwitchChannel} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          Switch Channel
        </button>
      </div>
    </header>
  );
}
