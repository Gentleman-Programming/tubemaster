import { getServerSession } from "next-auth";
import { withAuditRoute } from "@/lib/audit/request";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createYoutubeAnalyticsSummary } from "@/lib/youtube-analytics-summary";
import type { AnalyticsSummaryResponse } from "@/lib/youtube-analytics-summary";

type RouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  core: {
    fetchAnalyticsSummary: (args: {
      credentialRef: { userId: string };
      startDate: string;
      endDate: string;
    }) => Promise<AnalyticsSummaryResponse>;
  };
};
const status: Record<string, number> = {
  AUTH_REQUIRED: 401,
  AUTH_SCOPE_INSUFFICIENT: 403,
  INVALID_INPUT: 422,
  ANALYTICS_API_ERROR: 502,
};

export function createAnalyticsGetHandler(
  deps: RouteDeps = {
    getSession: () => getServerSession(authOptions),
    core: createYoutubeAnalyticsSummary(),
  },
) {
  return async (url: URL) => {
    const session = await deps.getSession();
    if (!session?.user?.id)
      return NextResponse.json(
        {
          kind: "analytics-summary-error",
          code: "AUTH_REQUIRED",
          message: "Authentication required",
        },
        { status: 401 },
      );
    try {
      const result = await deps.core.fetchAnalyticsSummary({
        credentialRef: { userId: session.user.id },
        startDate: url.searchParams.get("startDate") ?? "",
        endDate: url.searchParams.get("endDate") ?? "",
      });
      return result.kind === "analytics-summary-error"
        ? NextResponse.json(result, { status: status[result.code] ?? 500 })
        : NextResponse.json(result);
    } catch {
      return NextResponse.json(
        {
          kind: "analytics-summary-error",
          code: "ANALYTICS_API_ERROR",
          message: "Internal error",
        },
        { status: 500 },
      );
    }
  };
}
async function getHandler(request: Request) {
  try {
    return await createAnalyticsGetHandler()(new URL(request.url));
  } catch {
    return NextResponse.json(
      {
        kind: "analytics-summary-error",
        code: "ANALYTICS_API_ERROR",
        message: "Internal error",
      },
      { status: 500 },
    );
  }
}

export const GET = withAuditRoute("youtube.analytics.summary", getHandler);
