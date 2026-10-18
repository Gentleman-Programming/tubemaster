import { resolveGoogleCredentials } from "../video-metadata/adapters/google-auth";
import { quotaClient } from "../db";
import { createDurableQuotaAccountant } from "../quota/accountant";
import { createYoutubeAnalyticsApi } from "./adapters/youtube-analytics-api";
import type { AnalyticsSummaryDependencies } from "./contracts";
import { createYoutubeAnalyticsSummaryService } from "./services";
export type {
  AnalyticsSummaryInput,
  AnalyticsDayRow,
  AnalyticsTrafficSourceRow,
  AnalyticsSummaryResult,
  AnalyticsSummaryError,
  AnalyticsSummaryResponse,
  AnalyticsSummaryErrorCode,
} from "./contracts";

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
