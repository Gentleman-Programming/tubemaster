import { NextResponse } from "next/server";
import { withAuditRoute } from "@/lib/audit/request";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createPlaylistManagementCore } from "@/lib/playlist-management";
import { DomainError } from "@/lib/video-metadata/contracts";
import { getVideoMetadataErrorStatus } from "@/app/api/video-metadata/error-status";

type PlaylistsRouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  core: Pick<ReturnType<typeof createPlaylistManagementCore>, "listPlaylists">;
};

export function createPlaylistsGetHandler(
  deps: PlaylistsRouteDeps = {
    getSession: () => getServerSession(authOptions),
    core: createPlaylistManagementCore(),
  }
) {
  return async function GET() {
    const session = await deps.getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const result = await deps.core.listPlaylists({
        credentialRef: { userId: session.user.id },
      });

      return NextResponse.json(result.playlists);
    } catch (error) {
      if (error instanceof DomainError) {
        return NextResponse.json(
          { error: error.code, message: error.message, details: error.details },
          { status: getVideoMetadataErrorStatus(error.code) }
        );
      }

      return NextResponse.json(
        { error: "internal_error", message: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

export const GET = withAuditRoute("youtube.playlists.list", createPlaylistsGetHandler());
