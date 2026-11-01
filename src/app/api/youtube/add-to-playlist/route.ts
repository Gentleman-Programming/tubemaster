import { NextResponse } from "next/server";
import { withAuditRoute } from "@/lib/audit/request";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createPlaylistManagementCore } from "@/lib/playlist-management";

type AddToPlaylistRouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  core: Pick<ReturnType<typeof createPlaylistManagementCore>, "addVideosToPlaylist">;
};

export function createAddToPlaylistPostHandler(
  deps: AddToPlaylistRouteDeps = {
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

    const result = await deps.core.addVideosToPlaylist({
      credentialRef: { userId: session.user.id },
      videoIds,
      playlistId,
    });

    return NextResponse.json({ added: result.added });
  };
}

export const POST = withAuditRoute("youtube.playlists.add-videos", createAddToPlaylistPostHandler());
