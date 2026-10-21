import type { youtube_v3 } from "googleapis";
import type { ResolvedCredentials } from "../../video-metadata/contracts";
import {
  getAuthenticatedYoutubeFromTokens,
  getMyChannelId,
  listVideosByChannel,
  type QuotaRequestContext,
} from "../../youtube";
import type { YoutubeScheduleApi, YoutubeUploadStatus } from "../contracts";

const VIDEOS_LIST_BATCH = 50;

function recordQuota(context: QuotaRequestContext | undefined) {
  try {
    if (context?.operationId) context.quotaAccountant?.record({ operationId: context.operationId, operation: "videos.list" });
  } catch {
    // Accounting is observational and cannot affect YouTube requests.
  }
}

function thumbnailOf(snippet: youtube_v3.Schema$VideoSnippet | undefined): string | undefined {
  const thumbnails = snippet?.thumbnails;
  return thumbnails?.medium?.url ?? thumbnails?.default?.url ?? undefined;
}

/** Read-only: lists recent uploads with their privacy status and scheduled publish time. */
export function createYoutubeScheduleApi(deps: {
  youtubeFactory?: (credentials: ResolvedCredentials) => youtube_v3.Youtube | Promise<youtube_v3.Youtube>;
} = {}): YoutubeScheduleApi {
  const youtubeFor = (credentials: ResolvedCredentials) =>
    deps.youtubeFactory ? deps.youtubeFactory(credentials) : getAuthenticatedYoutubeFromTokens(credentials);

  return {
    async listRecentUploads({ credentials, maxVideos, quota }) {
      const youtube = await youtubeFor(credentials);
      const channelId = await getMyChannelId(youtube, quota);
      if (!channelId) return [];
      const uploads = await listVideosByChannel({
        youtube,
        channelId,
        maxResults: maxVideos,
        operationId: quota?.operationId,
        quotaAccountant: quota?.quotaAccountant,
      });
      // The uploads playlist does not carry status; videos.list holds privacyStatus and publishAt.
      const videos: YoutubeUploadStatus[] = [];
      for (let i = 0; i < uploads.length; i += VIDEOS_LIST_BATCH) {
        const ids = uploads.slice(i, i + VIDEOS_LIST_BATCH).map((video) => video.videoId);
        recordQuota(quota);
        const res = await youtube.videos.list({ part: ["status", "snippet"], id: ids, maxResults: VIDEOS_LIST_BATCH });
        for (const item of res.data.items ?? []) {
          if (!item.id) continue;
          const thumbnailUrl = thumbnailOf(item.snippet);
          videos.push({
            videoId: item.id,
            title: item.snippet?.title ?? "",
            ...(item.status?.privacyStatus ? { privacyStatus: item.status.privacyStatus } : {}),
            ...(item.status?.publishAt ? { publishAt: item.status.publishAt } : {}),
            ...(thumbnailUrl ? { thumbnailUrl } : {}),
          });
        }
      }
      return videos;
    },
  };
}
