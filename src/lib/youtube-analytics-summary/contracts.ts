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
export type AnalyticsTrafficSourceRow = {
  sourceType: string;
  views: number;
  estimatedMinutesWatched: number;
};
export type AnalyticsRetentionRow = {
  elapsedVideoTimeRatio: number;
  audienceWatchRatio: number;
  relativeRetentionPerformance: number;
};
export type AnalyticsRetentionResult = {
  kind: "analytics-retention";
  videoId: string;
  rows: AnalyticsRetentionRow[];
};
export type AnalyticsRetentionError = {
  kind: "analytics-retention-error";
  code: AnalyticsSummaryErrorCode;
  message: string;
  requiredScopes?: ["yt-analytics.readonly"];
};
export type AnalyticsRetentionResponse = AnalyticsRetentionResult | AnalyticsRetentionError;

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
export type AnalyticsReportVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
};
export type AnalyticsReportResult = {
  kind: "analytics-multi-video-report";
  startDate: string;
  endDate: string;
  videos: Array<{
    videoId: string;
    title: string;
    current: AnalyticsMetricRow;
    previous: AnalyticsMetricRow;
    deltas: {
      views: { absolute: number; percentage: number | null };
      likes: { absolute: number; percentage: number | null };
      comments: { absolute: number; percentage: number | null };
      estimatedMinutesWatched: { absolute: number; percentage: number | null };
    };
  }>;
  totals: AnalyticsMetricRow;
};
export type AnalyticsReportError = {
  kind: "analytics-multi-video-report-error";
  code: AnalyticsSummaryErrorCode;
  message: string;
  requiredScopes?: ["yt-analytics.readonly"];
};
export type AnalyticsReportResponse = AnalyticsReportResult | AnalyticsReportError;
export type AnalyticsReportDependencies = {
  authResolver: AnalyticsSummaryDependencies["authResolver"];
  youtubeAnalyticsApi: {
    queryVideoSummary(args: {
      credentials: ResolvedCredentials;
      videoId: string;
      startDate: string;
      endDate: string;
    }): Promise<AnalyticsMetricRow>;
  };
  now?: () => Date;
};
export type AnalyticsRetentionDependencies = {
  authResolver: {
    resolve(args: {
      credentialRef: unknown;
      requiredScopes: readonly string[];
    }): Promise<ResolvedCredentials>;
  };
  youtubeAnalyticsApi: {
    queryRetention(args: {
      credentials: ResolvedCredentials;
      videoId: string;
      startDate: string;
      endDate: string;
    }): Promise<AnalyticsRetentionRow[]>;
  };
};
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
    queryVideoSummary?: (args: {
      credentials: ResolvedCredentials;
      videoId: string;
      startDate: string;
      endDate: string;
    }) => Promise<AnalyticsMetricRow>;
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
