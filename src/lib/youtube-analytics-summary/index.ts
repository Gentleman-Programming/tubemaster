import { resolveGoogleCredentials } from "../video-metadata/adapters/google-auth";
import { quotaClient } from "../db";
import { createDurableQuotaAccountant } from "../quota/accountant";
import { createYoutubeAnalyticsApi } from "./adapters/youtube-analytics-api";
import type { AnalyticsReportDependencies, AnalyticsRetentionDependencies, AnalyticsSummaryDependencies } from "./contracts";
import { createYoutubeAnalyticsReportService, createYoutubeAnalyticsRetentionService, createYoutubeAnalyticsSummaryService } from "./services";
export type {
  AnalyticsSummaryInput,
  AnalyticsMetricRow,
  AnalyticsDayRow,
  AnalyticsTrafficSourceRow,
  AnalyticsSummaryResult,
  AnalyticsSummaryError,
  AnalyticsSummaryResponse,
  AnalyticsSummaryErrorCode,
  AnalyticsReportVideo,
  AnalyticsReportResult,
  AnalyticsReportError,
  AnalyticsReportResponse,
  AnalyticsRetentionRow,
  AnalyticsRetentionResult,
  AnalyticsRetentionError,
  AnalyticsRetentionResponse,
} from "./contracts";

export function createYoutubeAnalyticsRetention(
  deps?: Partial<AnalyticsRetentionDependencies>,
) {
  const service = createYoutubeAnalyticsRetentionService({
    ...deps,
    authResolver: deps?.authResolver ?? { resolve: resolveGoogleCredentials },
    youtubeAnalyticsApi: deps?.youtubeAnalyticsApi ?? createYoutubeAnalyticsApi(),
  });
  return { fetchAnalyticsRetention: service };
}

export function createYoutubeAnalyticsReport(
  deps?: Partial<AnalyticsReportDependencies>,
) {
  const service = createYoutubeAnalyticsReportService({
    ...deps,
    authResolver: deps?.authResolver ?? { resolve: resolveGoogleCredentials },
    youtubeAnalyticsApi: deps?.youtubeAnalyticsApi ?? createYoutubeAnalyticsApi(),
  });
  return { fetchAnalyticsReport: service };
}

export function createYoutubeAnalyticsSummary(
  deps?: Partial<AnalyticsSummaryDependencies>,
) {
  const service = createYoutubeAnalyticsSummaryService({
    ...deps,
    authResolver: deps?.authResolver ?? { resolve: resolveGoogleCredentials },
    youtubeAnalyticsApi:
      deps?.youtubeAnalyticsApi ?? createYoutubeAnalyticsApi(),
    quotaAccountantFactory:
      deps?.quotaAccountantFactory ??
      ((credentials) => {
        if (!("userId" in credentials.credentialRef)) {
          throw new Error("User-scoped analytics credentials are required");
        }
        return createDurableQuotaAccountant({
          client: quotaClient,
          scope: { kind: "user", userId: credentials.credentialRef.userId },
        });
      }),
  });
  return { fetchAnalyticsSummary: service };
}
