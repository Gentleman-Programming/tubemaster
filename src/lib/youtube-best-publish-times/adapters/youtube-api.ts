import type { youtube_v3 } from "googleapis";
import { createGoogleOAuthClient } from "../../auth";
import { DomainError } from "../../video-metadata/contracts";
import type { ResolvedCredentials } from "../../video-metadata/contracts";
import {
  getAuthenticatedYoutubeFromTokens,
  getMyChannelId,
  listVideosByChannel,
  type QuotaRequestContext,
} from "../../youtube";
import type { BestPublishTimesApi, PublishedVideo } from "../contracts";

type ReportResponse = {
  rows?: unknown[][] | null;
  columnHeaders?: { name: string }[];
};
type ProviderResponse = ReportResponse | { data: unknown };
type AnalyticsClient = {
  reports: { query(args: Record<string, unknown>): Promise<ProviderResponse> };
};

const VIDEOS_LIST_BATCH = 50;
const malformed = () =>
  new DomainError({ code: "unauthorized", message: "Malformed analytics response" });

function recordQuota(context: QuotaRequestContext | undefined, operation: "videos.list") {
  try {
    if (context?.operationId) context.quotaAccountant?.record({ operationId: context.operationId, operation });
  } catch {
    // Accounting is observational and cannot affect YouTube requests.
  }
}

export function createBestPublishTimesApi(deps: {
  youtubeFactory?: (credentials: ResolvedCredentials) => youtube_v3.Youtube | Promise<youtube_v3.Youtube>;
  analyticsFactory?: () => AnalyticsClient;
} = {}): BestPublishTimesApi {
  const youtubeFor = (credentials: ResolvedCredentials) =>
    deps.youtubeFactory
      ? deps.youtubeFactory(credentials)
      : getAuthenticatedYoutubeFromTokens(credentials);

  const report = async (credentials: ResolvedCredentials, params: Record<string, unknown>) => {
    if (deps.analyticsFactory) return deps.analyticsFactory().reports.query(params);
    const { google } = await import("googleapis");
    const oauth2 = createGoogleOAuthClient();
    oauth2.setCredentials({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken });
    return google.youtubeAnalytics({ version: "v2", auth: oauth2 }).reports.query(params);
  };

  return {
    async listRecentVideos({ credentials, maxVideos, quota }) {
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
      // The uploads playlist reports when an item was added; videos.list holds the real publish time.
      const videos: PublishedVideo[] = [];
      for (let i = 0; i < uploads.length; i += VIDEOS_LIST_BATCH) {
        const ids = uploads.slice(i, i + VIDEOS_LIST_BATCH).map((video) => video.videoId);
        recordQuota(quota, "videos.list");
        const res = await youtube.videos.list({ part: ["snippet"], id: ids, maxResults: VIDEOS_LIST_BATCH });
        for (const item of res.data.items ?? []) {
          const publishedAt = item.snippet?.publishedAt;
          if (item.id && publishedAt) videos.push({ videoId: item.id, publishedAt });
        }
      }
      return videos.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    },

    async queryEarlyViews({ credentials, videoId, startDate, endDate }) {
      let response: ProviderResponse;
      try {
        response = await report(credentials, {
          ids: "channel==MINE",
          startDate,
          endDate,
          metrics: "views",
          filters: `video==${videoId}`,
        });
      } catch {
        throw new DomainError({ code: "unauthorized", message: "YouTube Analytics request failed" });
      }
      const data = ("data" in response ? response.data : response) as ReportResponse;
      const row = data.rows?.[0];
      if (!row) return 0;
      const index = (data.columnHeaders ?? []).findIndex((header) => header.name === "views");
      if (index < 0) throw malformed();
      const views = Number(row[index]);
      if (!Number.isFinite(views) || views < 0) throw malformed();
      return views;
    },
  };
}
