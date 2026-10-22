import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createYoutubeAnalyticsRetention } from "@/lib/youtube-analytics-summary";
import type { AnalyticsRetentionResponse } from "@/lib/youtube-analytics-summary";

type RouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  core: {
    fetchAnalyticsRetention: (args: { credentialRef: { userId: string }; videoId: string; startDate: string; endDate: string }) => Promise<AnalyticsRetentionResponse>;
  };
};
const status: Record<string, number> = {
  AUTH_REQUIRED: 401,
  AUTH_SCOPE_INSUFFICIENT: 403,
  INVALID_INPUT: 422,
  ANALYTICS_API_ERROR: 502,
};

export function createAnalyticsRetentionGetHandler(
  deps: RouteDeps = {
    getSession: () => getServerSession(authOptions),
    core: createYoutubeAnalyticsRetention(),
  },
) {
  return async (url: URL) => {
    const session = await deps.getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ kind: "analytics-retention-error", code: "AUTH_REQUIRED", message: "Authentication required" }, { status: 401 });
    }
    const videoId = url.searchParams.get("videoId") ?? "";
    const startDate = url.searchParams.get("startDate") ?? "";
    const endDate = url.searchParams.get("endDate") ?? "";
    if (!videoId.trim() || !startDate || !endDate) {
      return NextResponse.json({ kind: "analytics-retention-error", code: "INVALID_INPUT", message: "Invalid videoId or date range" }, { status: 422 });
    }
    try {
      const result = await deps.core.fetchAnalyticsRetention({
        credentialRef: { userId: session.user.id },
        videoId,
        startDate,
        endDate,
      });
      return result.kind === "analytics-retention-error"
        ? NextResponse.json(result, { status: status[result.code] ?? 500 })
        : NextResponse.json(result);
    } catch {
      return NextResponse.json({ kind: "analytics-retention-error", code: "ANALYTICS_API_ERROR", message: "Internal error" }, { status: 500 });
    }
  };
}

export async function GET(request: Request) {
  try {
    return await createAnalyticsRetentionGetHandler()(new URL(request.url));
  } catch {
    return NextResponse.json({ kind: "analytics-retention-error", code: "ANALYTICS_API_ERROR", message: "Internal error" }, { status: 500 });
  }
}
