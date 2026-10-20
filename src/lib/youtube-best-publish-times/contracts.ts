import type { ResolvedCredentials } from "../video-metadata/contracts";
import type { QuotaAccountant } from "../quota/accountant";
import type { QuotaRequestContext } from "../youtube";

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type PublishedVideo = { videoId: string; publishedAt: string };
export type EarlyViewsSample = PublishedVideo & { earlyViews: number };

export type PublishSlot = {
  weekday: Weekday;
  startHour: number;
  endHour: number;
  score: number;
  sampleSize: number;
  medianEarlyViews: number;
};

export type BestPublishTimesConfidence = "low" | "normal";

export type BestPublishTimesResult = {
  kind: "best-publish-times";
  timezone: string;
  analyzedVideos: number;
  excludedVideos: number;
  channelMedianEarlyViews: number;
  confidence: BestPublishTimesConfidence;
  slots: PublishSlot[];
  method: {
    maxVideos: number;
    minVideoAgeDays: number;
    earlyWindowDays: number;
    slotHours: number;
    minSlotSamples: number;
  };
};

export type BestPublishTimesErrorCode =
  | "INVALID_INPUT"
  | "AUTH_REQUIRED"
  | "AUTH_SCOPE_INSUFFICIENT"
  | "ANALYTICS_API_ERROR";

export type BestPublishTimesError = {
  kind: "best-publish-times-error";
  code: BestPublishTimesErrorCode;
  message: string;
  requiredScopes?: ["yt-analytics.readonly"];
};

export type BestPublishTimesResponse = BestPublishTimesResult | BestPublishTimesError;

export type BestPublishTimesApi = {
  listRecentVideos(args: {
    credentials: ResolvedCredentials;
    maxVideos: number;
    quota?: QuotaRequestContext;
  }): Promise<PublishedVideo[]>;
  queryEarlyViews(args: {
    credentials: ResolvedCredentials;
    videoId: string;
    startDate: string;
    endDate: string;
  }): Promise<number>;
};

export type BestPublishTimesDependencies = {
  authResolver: {
    resolve(args: {
      credentialRef: unknown;
      requiredScopes: readonly string[];
    }): Promise<ResolvedCredentials>;
  };
  api: BestPublishTimesApi;
  quotaAccountant?: QuotaAccountant;
  quotaAccountantFactory?: (credentials: ResolvedCredentials) => QuotaAccountant;
  operationIdFactory?: () => string;
  now?: () => Date;
};
