import { NextResponse } from "next/server";
import { withAuditRoute } from "@/lib/audit/request";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createPlaylistManagementCore } from "@/lib/playlist-management";

type CreatePlaylistRouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  core: Pick<ReturnType<typeof createPlaylistManagementCore>, "createPlaylist">;
};

export function createCreatePlaylistPostHandler(
  deps: CreatePlaylistRouteDeps = {
    getSession: () => getServerSession(authOptions),
    core: createPlaylistManagementCore(),
  }
) {
  return async function POST(request: Request) {
    const session = await deps.getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { title, description, privacyStatus } = await request.json();
    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const result = await deps.core.createPlaylist({
      credentialRef: { userId: session.user.id },
      title: title.trim(),
      description,
      privacyStatus,
    });

    return NextResponse.json(result.playlist, { status: 201 });
  };
}

export const POST = withAuditRoute("youtube.playlists.create", createCreatePlaylistPostHandler());
