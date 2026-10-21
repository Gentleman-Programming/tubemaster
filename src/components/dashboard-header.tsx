"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { nextChannelThumbnail } from "@/components/channel-thumbnail";
import { Badge, Button, Card } from "@/components/ui";

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
    <header>
      <Card as="div" className="overflow-hidden p-0 shadow-glow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            <p className="text-xl font-semibold text-fg">TubeMaster</p>
            <p className="font-mono text-xs text-subtle">Welcome, {session?.user?.name}</p>
          </div>
          <Button variant="secondary" onClick={() => signOut()}>
            Sign Out
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 bg-glass px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbnail} onError={() => setFailedThumbnail(thumbnail)} alt={channel?.title ?? "Channel"} className="h-10 w-10 shrink-0 rounded-full ring-2 ring-rose/40" />
            )}
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-widest text-rose">Active YouTube channel</p>
              <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                {channel?.title ?? (channelState.status === "loading" ? "Loading..." : channelState.status === "empty" ? "No channel found" : "Unable to load channel")}
                {channel?.videoCount && <Badge>{channel.videoCount} videos</Badge>}
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={handleSwitchChannel}>
            Switch Channel
          </Button>
        </div>
      </Card>
    </header>
  );
}
