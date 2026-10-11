import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { quotaClient } from "@/lib/db";
import { createDurableQuotaAccountant } from "@/lib/quota/accountant";
import { resolveGoogleCredentials } from "@/lib/video-metadata/adapters/google-auth";
import {
  createYoutubeAnalyticsApi,
  createYoutubeAnalyticsSummaryService,
  type AnalyticsSummaryRequest,
  type AnalyticsSummaryResponse,
} from "@/lib/youtube-analytics-summary";

type AnalyticsService = (input: AnalyticsSummaryRequest) => Promise<AnalyticsSummaryResponse>;

interface AnalyticsRouteDeps {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  service: AnalyticsService;
}

const errorResponse = (code: "AUTH_REQUIRED" | "INVALID_INPUT" | "AUTH_SCOPE_INSUFFICIENT" | "ANALYTICS_API_ERROR", message: string, status: number, requiredScopes?: string[]) =>
  Response.json({ kind: "analytics-summary-error", code, message, ...(requiredScopes ? { requiredScopes } : {}) }, { status });

export function createAnalyticsGetHandler(deps: AnalyticsRouteDeps) {
  return async function GET(request: Request): Promise<Response> {
    try {
      const session = await deps.getSession();
      if (!session?.user?.id) {
        return errorResponse("AUTH_REQUIRED", "YouTube authorization is required", 401);
      }

      const params = new URL(request.url).searchParams;
      if (params.has("channelId")) {
        return errorResponse("INVALID_INPUT", "channelId is not supported", 422);
      }

      const result = await deps.service({
        credentialRef: { userId: session.user.id },
        startDate: params.get("startDate") ?? "",
        endDate: params.get("endDate") ?? "",
      });
      if (result.kind === "analytics-summary") return Response.json(result);

      switch (result.code) {
        case "AUTH_REQUIRED":
          return errorResponse("AUTH_REQUIRED", "YouTube authorization is required", 401);
        case "AUTH_SCOPE_INSUFFICIENT":
          return errorResponse("AUTH_SCOPE_INSUFFICIENT", "Reauthorize Google with YouTube Analytics read access.", 403, ["yt-analytics.readonly"]);
        case "INVALID_INPUT":
          return errorResponse("INVALID_INPUT", result.message, 422);
        case "ANALYTICS_API_ERROR":
          return errorResponse("ANALYTICS_API_ERROR", "YouTube Analytics request failed", 502);
      }
    } catch {
      return errorResponse("ANALYTICS_API_ERROR", "YouTube Analytics request failed", 500);
    }
  };
}

async function runDefaultService(input: AnalyticsSummaryRequest): Promise<AnalyticsSummaryResponse> {
  if (!("userId" in input.credentialRef)) {
    return {
      kind: "analytics-summary-error",
      code: "AUTH_REQUIRED",
      message: "YouTube authorization is required",
    };
  }

  return createYoutubeAnalyticsSummaryService({
    authResolver: { resolve: resolveGoogleCredentials },
    youtubeAnalyticsApi: createYoutubeAnalyticsApi(),
    quotaAccountant: createDurableQuotaAccountant({
      client: quotaClient,
      scope: { kind: "user", userId: input.credentialRef.userId },
    }),
  })(input);
}

export function GET(request: Request): Promise<Response> {
  return createAnalyticsGetHandler({
    getSession: () => getServerSession(authOptions),
    service: runDefaultService,
  })(request);
}
