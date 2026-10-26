import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createYoutubeAnalyticsReport } from "@/lib/youtube-analytics-summary";
import type { AnalyticsReportResponse, AnalyticsReportVideo } from "@/lib/youtube-analytics-summary";
import { createVideoMetadataCore } from "@/lib/video-metadata";
import { validateReportVideoSelection } from "@/lib/reporting/multi-video-report";

type RouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  listVideos: (args: { credentialRef: { userId: string } }) => Promise<{ videos: AnalyticsReportVideo[] }>;
  core: {
    fetchAnalyticsReport: (args: {
      credentialRef: { userId: string };
      startDate: string;
      endDate: string;
      videos: AnalyticsReportVideo[];
    }) => Promise<AnalyticsReportResponse>;
  };
};

const status: Record<string, number> = {
  AUTH_REQUIRED: 401,
  AUTH_SCOPE_INSUFFICIENT: 403,
  INVALID_INPUT: 422,
  ANALYTICS_API_ERROR: 502,
};

export function createAnalyticsReportGetHandler(
  deps: RouteDeps = {
    getSession: () => getServerSession(authOptions),
    listVideos: (args) => createVideoMetadataCore().listVideos(args),
    core: createYoutubeAnalyticsReport(),
  },
) {
  return async (url: URL) => {
    const session = await deps.getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ kind: "analytics-multi-video-report-error", code: "AUTH_REQUIRED", message: "Authentication required" }, { status: 401 });
    }
    const videoIds = url.searchParams.getAll("videoId").length
      ? url.searchParams.getAll("videoId")
      : (url.searchParams.get("videoIds") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    try {
      const listed = await deps.listVideos({ credentialRef: { userId: session.user.id } });
      const selection = validateReportVideoSelection(videoIds, listed.videos);
      if (!selection.ok) {
        return NextResponse.json({ kind: "analytics-multi-video-report-error", code: "INVALID_INPUT", message: selection.message }, { status: 422 });
      }
      const result = await deps.core.fetchAnalyticsReport({
        credentialRef: { userId: session.user.id },
        startDate: url.searchParams.get("startDate") ?? "",
        endDate: url.searchParams.get("endDate") ?? "",
        videos: selection.videos,
      });
      return result.kind === "analytics-multi-video-report-error"
        ? NextResponse.json(result, { status: status[result.code] ?? 500 })
        : NextResponse.json(result);
    } catch {
      return NextResponse.json({ kind: "analytics-multi-video-report-error", code: "ANALYTICS_API_ERROR", message: "Unable to load analytics report" }, { status: 502 });
    }
  };
}

export async function GET(request: Request) {
  try {
    return await createAnalyticsReportGetHandler()(new URL(request.url));
  } catch {
    return NextResponse.json({ kind: "analytics-multi-video-report-error", code: "ANALYTICS_API_ERROR", message: "Unable to load analytics report" }, { status: 502 });
  }
}
