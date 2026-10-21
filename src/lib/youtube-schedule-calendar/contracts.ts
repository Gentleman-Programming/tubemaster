import type { ResolvedCredentials } from "../video-metadata/contracts";
import type { QuotaAccountant } from "../quota/accountant";
import type { QuotaRequestContext } from "../youtube";

/** A private upload with a scheduled publish time (read-only view). */
export type ScheduledYoutubeVideo = {
  videoId: string;
  title: string;
  publishAt: string;
  thumbnailUrl?: string;
};

/** Raw upload status as listed by the provider adapter. */
export type YoutubeUploadStatus = {
  videoId: string;
  title: string;
  privacyStatus?: string;
  publishAt?: string;
  thumbnailUrl?: string;
};

export type ScheduledYoutubeVideosResult = { kind: "youtube-scheduled-videos"; videos: ScheduledYoutubeVideo[] };

export type ScheduledYoutubeVideosErrorCode = "AUTH_REQUIRED" | "AUTH_SCOPE_INSUFFICIENT" | "YOUTUBE_API_ERROR";

export type ScheduledYoutubeVideosError = {
  kind: "youtube-scheduled-videos-error";
  code: ScheduledYoutubeVideosErrorCode;
  message: string;
  requiredScopes?: ["youtube.readonly"];
};

export type ScheduledYoutubeVideosResponse = ScheduledYoutubeVideosResult | ScheduledYoutubeVideosError;

export type YoutubeScheduleApi = {
  listRecentUploads(args: {
    credentials: ResolvedCredentials;
    maxVideos: number;
    quota?: QuotaRequestContext;
  }): Promise<YoutubeUploadStatus[]>;
};

export type YoutubeScheduleDependencies = {
  authResolver: {
    resolve(args: { credentialRef: unknown; requiredScopes: readonly string[] }): Promise<ResolvedCredentials>;
  };
  api: YoutubeScheduleApi;
  quotaAccountant?: QuotaAccountant;
  quotaAccountantFactory?: (credentials: ResolvedCredentials) => QuotaAccountant;
  operationIdFactory?: () => string;
};
