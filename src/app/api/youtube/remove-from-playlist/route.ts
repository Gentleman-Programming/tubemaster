import { NextResponse } from "next/server";
import { withAuditRoute } from "@/lib/audit/request";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createPlaylistManagementCore } from "@/lib/playlist-management";

type RemoveFromPlaylistRouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  core: Pick<ReturnType<typeof createPlaylistManagementCore>, "removeVideosFromPlaylist">;
};

export function createRemoveFromPlaylistPostHandler(
  deps: RemoveFromPlaylistRouteDeps = {
    getSession: () => getServerSession(authOptions),
    core: createPlaylistManagementCore(),
  }
) {
  return async function POST(request: Request) {
    const session = await deps.getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { videoIds, playlistId } = await request.json();
    if (!videoIds?.length || !playlistId) {
      return NextResponse.json(
        { error: "Missing videoIds or playlistId" },
        { status: 400 }
      );
    }

    const result = await deps.core.removeVideosFromPlaylist({
      credentialRef: { userId: session.user.id },
      videoIds,
      playlistId,
    });

    return NextResponse.json({ removed: result.removed });
  };
}

export const POST = withAuditRoute("youtube.playlists.remove-videos", createRemoveFromPlaylistPostHandler());
