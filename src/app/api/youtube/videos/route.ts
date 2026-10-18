import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAuthenticatedYoutube } from "@/lib/youtube";
import { createVideoMetadataCore } from "@/lib/video-metadata";

const videoMetadataCore = createVideoMetadataCore();

type ListedVideo = { videoId: string; title: string; description: string; publishedAt: string };
type VideoStatus = { id?: string | null; status?: { privacyStatus?: string | null } | null };

export function filterPrivateVideos(videos: ListedVideo[], statuses: VideoStatus[]): ListedVideo[] {
  const privateVideoIds = new Set(
    statuses
      .filter((video) => video.status?.privacyStatus === "private")
      .map((video) => video.id)
      .filter((videoId): videoId is string => Boolean(videoId)),
  );
  return videos.filter((video) => privateVideoIds.has(video.videoId));
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get("debug") === "1") {
    const youtube = await getAuthenticatedYoutube(session.user.id);
    const channels = await youtube.channels.list({
      part: ["snippet", "contentDetails", "statistics"],
      mine: true,
    });
    return NextResponse.json({
      channels: channels.data.items?.map((c) => ({
        id: c.id,
        title: c.snippet?.title,
        videoCount: c.statistics?.videoCount,
        uploadsPlaylist: c.contentDetails?.relatedPlaylists?.uploads,
      })),
    });
  }

  const listed = await videoMetadataCore.listVideos({
    credentialRef: { userId: session.user.id },
  });

  if (searchParams.get("privateOnly") !== "1" || listed.videos.length === 0) {
    return NextResponse.json(listed.videos);
  }

  const youtube = await getAuthenticatedYoutube(session.user.id);
  const statuses = await youtube.videos.list({
    part: ["status"],
    id: listed.videos.map((video) => video.videoId),
  });
  return NextResponse.json(filterPrivateVideos(listed.videos, statuses.data.items ?? []));
}
