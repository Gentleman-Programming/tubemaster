import { YOUTUBE_READ_SCOPE } from "../auth";
import { isDomainError, type ResolvedCredentials } from "../video-metadata/contracts";
import type {
  ScheduledYoutubeVideo,
  ScheduledYoutubeVideosErrorCode,
  ScheduledYoutubeVideosResponse,
  YoutubeScheduleDependencies,
} from "./contracts";

const MAX_RECENT_UPLOADS = 50;

const error = (
  code: ScheduledYoutubeVideosErrorCode,
  message: string,
  requiredScopes?: ["youtube.readonly"],
): ScheduledYoutubeVideosResponse => ({
  kind: "youtube-scheduled-videos-error",
  code,
  message,
  ...(requiredScopes ? { requiredScopes } : {}),
});

export function createScheduledYoutubeVideosService(deps: YoutubeScheduleDependencies) {
  return async (args: { credentialRef: unknown }): Promise<ScheduledYoutubeVideosResponse> => {
    let credentials: ResolvedCredentials;
    try {
      credentials = await deps.authResolver.resolve({ credentialRef: args.credentialRef, requiredScopes: [YOUTUBE_READ_SCOPE] });
    } catch (err) {
      return isDomainError(err) && err.code === "AUTH_SCOPE_INSUFFICIENT"
        ? error("AUTH_SCOPE_INSUFFICIENT", "Reauthorization with the youtube.readonly scope is required.", ["youtube.readonly"])
        : error("AUTH_REQUIRED", "Authentication required");
    }
    const quotaAccountant = deps.quotaAccountantFactory?.(credentials) ?? deps.quotaAccountant;
    const operationId = deps.operationIdFactory?.() ?? `op-${Date.now()}`;
    try {
      const uploads = await deps.api.listRecentUploads({
        credentials,
        maxVideos: MAX_RECENT_UPLOADS,
        quota: { operationId, quotaAccountant },
      });
      // YouTube only publishes at publishAt while the video is still private.
      const videos: ScheduledYoutubeVideo[] = uploads
        .filter((upload) => upload.privacyStatus === "private" && upload.publishAt && Number.isFinite(Date.parse(upload.publishAt)))
        .map((upload) => ({
          videoId: upload.videoId,
          title: upload.title,
          publishAt: upload.publishAt as string,
          ...(upload.thumbnailUrl ? { thumbnailUrl: upload.thumbnailUrl } : {}),
        }))
        .sort((a, b) => Date.parse(a.publishAt) - Date.parse(b.publishAt));
      return { kind: "youtube-scheduled-videos", videos };
    } catch {
      return error("YOUTUBE_API_ERROR", "YouTube request failed");
    }
  };
}
