import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createScheduledYoutubeVideos } from "@/lib/youtube-schedule-calendar";
import type { ScheduledYoutubeVideosResponse } from "@/lib/youtube-schedule-calendar";

type RouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  core: {
    fetchScheduledVideos: (args: { credentialRef: { userId: string } }) => Promise<ScheduledYoutubeVideosResponse>;
  };
};
const status: Record<string, number> = {
  AUTH_REQUIRED: 401,
  AUTH_SCOPE_INSUFFICIENT: 403,
  YOUTUBE_API_ERROR: 502,
};
const internalError = () =>
  NextResponse.json(
    { kind: "youtube-scheduled-videos-error", code: "YOUTUBE_API_ERROR", message: "Internal error" },
    { status: 500 },
  );

/** Read-only list of the user's private uploads that have a scheduled publish time. */
export function createScheduledVideosGetHandler(
  deps: RouteDeps = {
    getSession: () => getServerSession(authOptions),
    core: createScheduledYoutubeVideos(),
  },
) {
  return async () => {
    const session = await deps.getSession();
    if (!session?.user?.id)
      return NextResponse.json(
        { kind: "youtube-scheduled-videos-error", code: "AUTH_REQUIRED", message: "Authentication required" },
        { status: 401 },
      );
    try {
      const result = await deps.core.fetchScheduledVideos({ credentialRef: { userId: session.user.id } });
      return result.kind === "youtube-scheduled-videos-error"
        ? NextResponse.json(result, { status: status[result.code] ?? 500 })
        : NextResponse.json(result);
    } catch {
      return internalError();
    }
  };
}

export async function GET() {
  try {
    return await createScheduledVideosGetHandler()();
  } catch {
    return internalError();
  }
}
