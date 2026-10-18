import type { ResolvedCredentials } from "../video-metadata/contracts";
import type { QuotaAccountant } from "../quota/accountant";

export type AnalyticsSummaryInput = { startDate: string; endDate: string };
export type AnalyticsMetricRow = {
  views: number;
  likes: number;
  comments: number;
  estimatedMinutesWatched: number;
};
export type AnalyticsDayRow = AnalyticsMetricRow & { date: string };
export type AnalyticsTrafficSourceRow = AnalyticsMetricRow & {
  sourceType: string;
};
export type AnalyticsSummaryResult = {
  kind: "analytics-summary";
  startDate: string;
  endDate: string;
  days: AnalyticsDayRow[];
  trafficSources: AnalyticsTrafficSourceRow[];
};
export type AnalyticsSummaryErrorCode =
  | "INVALID_INPUT"
  | "AUTH_REQUIRED"
  | "AUTH_SCOPE_INSUFFICIENT"
  | "ANALYTICS_API_ERROR";
export type AnalyticsSummaryError = {
  kind: "analytics-summary-error";
  code: AnalyticsSummaryErrorCode;
  message: string;
  requiredScopes?: ["yt-analytics.readonly"];
};
export type AnalyticsSummaryResponse =
  | AnalyticsSummaryResult
  | AnalyticsSummaryError;
export type AnalyticsSummaryDependencies = {
  authResolver: {
    resolve(args: {
      credentialRef: unknown;
      requiredScopes: readonly string[];
    }): Promise<ResolvedCredentials>;
  };
  youtubeAnalyticsApi: {
    query(args: {
      credentials: ResolvedCredentials;
      startDate: string;
      endDate: string;
    }): Promise<AnalyticsDayRow[]>;
    queryTrafficSources?: (args: {
      credentials: ResolvedCredentials;
      startDate: string;
      endDate: string;
    }) => Promise<AnalyticsTrafficSourceRow[]>;
  };
  quotaAccountant?: QuotaAccountant;
  quotaAccountantFactory?: (
    credentials: ResolvedCredentials,
  ) => QuotaAccountant;
  operationIdFactory?: () => string;
  now?: () => Date;
};
