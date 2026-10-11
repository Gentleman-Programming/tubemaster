import type { CredentialRef, ResolvedCredentials } from "../video-metadata/contracts";

export interface AnalyticsSummaryRequest {
  credentialRef: CredentialRef;
  startDate: string;
  endDate: string;
}

export const ANALYTICS_SUMMARY_ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_SCOPE_INSUFFICIENT: "AUTH_SCOPE_INSUFFICIENT",
  ANALYTICS_API_ERROR: "ANALYTICS_API_ERROR",
} as const;

export type AnalyticsSummaryErrorCode = typeof ANALYTICS_SUMMARY_ERROR_CODES[keyof typeof ANALYTICS_SUMMARY_ERROR_CODES];

export interface AnalyticsSummarySuccess {
  kind: "analytics-summary";
  startDate: string;
  endDate: string;
  days: DailyAnalyticsRow[];
}

export interface AnalyticsSummaryError {
  kind: "analytics-summary-error";
  code: AnalyticsSummaryErrorCode;
  message: string;
  requiredScopes?: string[];
}

export type AnalyticsSummaryResponse = AnalyticsSummarySuccess | AnalyticsSummaryError;

export interface DailyAnalyticsRow {
  date: string;
  views: number;
  likes: number;
  comments: number;
  estimatedMinutesWatched: number;
}

export interface AnalyticsQuery {
  credentials: ResolvedCredentials;
  startDate: string;
  endDate: string;
}

export interface YoutubeAnalyticsApi {
  query(args: AnalyticsQuery): Promise<DailyAnalyticsRow[]>;
}
